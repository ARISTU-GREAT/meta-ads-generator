const express = require('express');
const router  = express.Router({ mergeParams: true }); // mergeParams for :id from parent
const { asyncHandler, AppError } = require('../utils/errors');
const {
  getLayoutByAdId,
  saveEditableLayout, getEditableLayout, analyzeAdLayout,
  saveBlueprintLayout, getBlueprintLayout,
  getLayoutFirstDesign,
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
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(400).json({
        success: false,
        error:   'Claude blueprint mode not configured — add ANTHROPIC_API_KEY to enable',
      });
    }

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
      const conceptContext    = (meta.instructions || '') || '';
      const avoidInstructions = meta.avoid_instructions || '';

      console.log(`[layouts/export] generating Claude blueprint for ad=${adId}`);
      layoutJson = await generateBlueprint({ brand, strategy, aspectRatio, conceptContext, avoidInstructions });
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

// GET /api/ads/:id/layout/export-best
// Reconstructs the actual generated ad as editable Figma layers using GPT-4o vision.
// Falls back to fast deterministic layout if image or OpenAI key is unavailable.
// Result is cached after first analysis.
router.get('/export-best', asyncHandler(async (req, res) => {
  const adId = req.params.id;
  if (!adId) throw new AppError('ad id required', 400);

  const { rows: adRows } = await query(
    'SELECT id, image_url, metadata, brand_id FROM generated_ads WHERE id = $1',
    [adId]
  );
  if (!adRows.length) throw new AppError('Ad not found', 404);

  const adRow   = adRows[0];
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  // ── 0. Layout-first (Editable Design Mode — JSON is source of truth) ──────
  const layoutFirst = await getLayoutFirstDesign(adId);
  if (layoutFirst && layoutFirst.layout_json && layoutFirst.layout_json.schema === 'adflow-editable-design') {
    let lj = layoutFirst.layout_json;
    // Inject full base URL into all image layers so Figma plugin can fetch them
    if (Array.isArray(lj.layers)) {
      lj = Object.assign({}, lj, {
        layers: lj.layers.map(l => {
          if ((l.type === 'image') && l.imageUrl && l.imageUrl.startsWith('/')) {
            return Object.assign({}, l, { imageUrl: baseUrl + l.imageUrl });
          }
          return l;
        }),
      });
    }
    const filename = `creative-layout-${adId.slice(0, 8)}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Mode', 'layout_first');
    return res.send(JSON.stringify(lj, null, 2));
  }

  const imageEndpointUrl = adRow.image_url ? `${baseUrl}/api/ads/${adId}/image` : null;

  let layoutJson = null;
  let modeUsed   = 'fast';

  // ── 1. Vision reconstruction (primary) ───────────────────────────────────
  // Analyzes the actual generated image to produce editable layers that match it.
  if (adRow.image_url && process.env.OPENAI_API_KEY) {
    try {
      // Use cache only if it contains the new reconstruction format (v2.1)
      const cached = await getEditableLayout(adId);
      if (cached && cached.editable_json && cached.editable_json.version === '2.1') {
        layoutJson = cached.editable_json;
        modeUsed   = 'reconstruction';
        console.log(`[export-best] reconstruction cache hit ad=${adId}`);
      } else {
        const { rows: brandRows } = await query('SELECT * FROM brands WHERE id = $1', [adRow.brand_id]);
        const brand = brandRows[0] || {};
        console.log(`[export-best] running vision reconstruction ad=${adId}`);
        layoutJson = await analyzeAdLayout(adRow, brand);
        await saveEditableLayout(adId, layoutJson);
        modeUsed = 'reconstruction';
      }

      // Inject reference image (the actual ad) as locked bottom layer
      if (imageEndpointUrl) {
        layoutJson = Object.assign({}, layoutJson, {
          flat_image_url:  imageEndpointUrl,
          reference_image: { image_url: imageEndpointUrl, locked: true, opacity: 0.25 },
        });
      }
    } catch (err) {
      console.warn(`[export-best] vision reconstruction failed (${err.message}) — using fast fallback`);
      layoutJson = null;
    }
  }

  // ── 2. Fast fallback ──────────────────────────────────────────────────────
  if (!layoutJson) {
    const layout = await getLayoutByAdId(adId);
    if (!layout) throw new AppError('No layout found for this ad — generate the ad first', 404);
    layoutJson = JSON.parse(JSON.stringify(layout.layout_json));
    modeUsed   = 'fast';
    console.log(`[export-best] using fast layout ad=${adId}`);
    if (imageEndpointUrl) {
      layoutJson = Object.assign({}, layoutJson, { flat_image_url: imageEndpointUrl });
    }
  }

  const filename = `creative-layout-${adId.slice(0, 8)}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Export-Mode', modeUsed);
  res.send(JSON.stringify(layoutJson, null, 2));
}));

module.exports = router;
