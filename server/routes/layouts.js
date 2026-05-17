const express = require('express');
const router  = express.Router({ mergeParams: true }); // mergeParams for :id from parent
const { asyncHandler, AppError } = require('../utils/errors');
const {
  getLayoutByAdId,
  saveEditableLayout, getEditableLayout, analyzeAdLayout,
  saveBlueprintLayout, getBlueprintLayout,
} = require('../services/layoutService');
const { generateBlueprint } = require('../services/claudeDesignService');
const { query }              = require('../db');

// GET /api/ads/:id/layout
// Returns the stored creative layout for the given ad
router.get('/', asyncHandler(async (req, res) => {
  const adId = req.params.id;
  if (!adId) throw new AppError('ad id required', 400);

  // Verify the ad exists and belongs to the authenticated user's brand
  const { rows: adRows } = await query('SELECT id, brand_id FROM generated_ads WHERE id = $1', [adId]);
  if (!adRows.length) throw new AppError('Ad not found', 404);

  const layout = await getLayoutByAdId(adId);
  if (!layout) throw new AppError('No layout found for this ad. Layout is generated automatically after image generation.', 404);

  res.json({ success: true, data: layout });
}));

// GET /api/ads/:id/layout/export[?mode=fast|editable|blueprint]
// Returns a downloadable layout JSON file for the Figma Creative Importer plugin.
//
// fast (default) — deterministic V1 layout built from strategy, instant
// editable        — GPT-4o vision analysis of the generated image, cached in DB
// blueprint       — Claude text-based design blueprint, cached in DB
router.get('/export', asyncHandler(async (req, res) => {
  const adId = req.params.id;
  if (!adId) throw new AppError('ad id required', 400);

  const mode = (req.query.mode || 'fast').toLowerCase();

  const { rows: adRows } = await query(
    'SELECT id, image_url, metadata, brand_id FROM generated_ads WHERE id = $1',
    [adId]
  );
  if (!adRows.length) throw new AppError('Ad not found', 404);

  const baseUrl          = `${req.protocol}://${req.get('host')}`;
  const imageEndpointUrl = adRows[0].image_url ? `${baseUrl}/api/ads/${adId}/image` : null;
  const adRow            = adRows[0];

  // Helper: load brand row (needed for editable and blueprint modes)
  async function loadBrand() {
    const { rows } = await query('SELECT * FROM brands WHERE id = $1', [adRow.brand_id]);
    return rows[0] || {};
  }

  let layoutJson;

  if (mode === 'blueprint') {
    // Check cache
    const cached = await getBlueprintLayout(adId);
    if (cached && cached.blueprint_json) {
      layoutJson = cached.blueprint_json;
      console.log(`[layouts/export] blueprint cache hit for ad=${adId}`);
    } else {
      const brand    = await loadBrand();
      const rawMeta  = adRow.metadata;
      const meta     = rawMeta ? (typeof rawMeta === 'string' ? JSON.parse(rawMeta) : rawMeta) : {};
      const strategy = meta.strategy || null;
      const aspectRatio = (strategy && strategy.aspect_ratio) || meta.aspect_ratio || 'square';

      // Concept context from metadata (optional)
      const conceptContext = (meta.instructions || '') || '';

      console.log(`[layouts/export] generating Claude blueprint for ad=${adId}`);
      layoutJson = await generateBlueprint({ brand, strategy, aspectRatio, conceptContext });
      await saveBlueprintLayout(adId, layoutJson);
    }

    // Inject image URL for product/logo placeholders that have a real source
    if (imageEndpointUrl) {
      layoutJson = Object.assign({}, layoutJson, { flat_image_url: imageEndpointUrl });
      if (Array.isArray(layoutJson.layers)) {
        layoutJson.layers = layoutJson.layers.map(l => {
          if (l.type === 'product_image') return Object.assign({}, l, { image_url: imageEndpointUrl });
          return l;
        });
      }
    }

  } else if (mode === 'editable') {
    const cached = await getEditableLayout(adId);
    if (cached && cached.editable_json) {
      layoutJson = cached.editable_json;
      console.log(`[layouts/export] editable cache hit for ad=${adId}`);
    } else {
      if (!adRow.image_url) throw new AppError('Ad has no generated image — generate the ad first', 400);
      const brand = await loadBrand();
      console.log(`[layouts/export] running vision analysis for ad=${adId}`);
      layoutJson = await analyzeAdLayout(adRow, brand);
      await saveEditableLayout(adId, layoutJson);
    }
    if (imageEndpointUrl) {
      layoutJson = Object.assign({}, layoutJson, { flat_image_url: imageEndpointUrl });
    }

  } else {
    // Fast — stored layout_json
    const layout = await getLayoutByAdId(adId);
    if (!layout) throw new AppError('No layout found for this ad', 404);
    layoutJson = JSON.parse(JSON.stringify(layout.layout_json));
  }

  // Inject image_url into uppercase IMAGE layers (V1/V2 format)
  if (imageEndpointUrl && Array.isArray(layoutJson.layers)) {
    layoutJson.layers = layoutJson.layers.map(layer => {
      if (layer.type === 'IMAGE') return Object.assign({}, layer, { image_url: imageEndpointUrl });
      return layer;
    });
  }

  const suffix   = mode !== 'fast' ? `-${mode}` : '';
  const filename = `creative-layout-${adId.slice(0, 8)}${suffix}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(layoutJson, null, 2));
}));

module.exports = router;
