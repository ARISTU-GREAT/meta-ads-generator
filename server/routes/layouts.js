const express = require('express');
const router  = express.Router({ mergeParams: true }); // mergeParams for :id from parent
const { asyncHandler, AppError } = require('../utils/errors');
const { getLayoutByAdId, saveEditableLayout, getEditableLayout, analyzeAdLayout } = require('../services/layoutService');
const { query }                  = require('../db');

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

// GET /api/ads/:id/layout/export[?mode=editable]
// Returns the layout JSON as a downloadable .json file (Figma plugin import).
// mode=editable: uses GPT-4o vision to extract real editable layers (cached in DB).
// IMAGE layers are enriched with an absolute image_url so the plugin fetches real pixels.
router.get('/export', asyncHandler(async (req, res) => {
  const adId = req.params.id;
  if (!adId) throw new AppError('ad id required', 400);

  const mode = (req.query.mode || 'fast').toLowerCase();

  const { rows: adRows } = await query(
    'SELECT id, image_url, metadata FROM generated_ads WHERE id = $1',
    [adId]
  );
  if (!adRows.length) throw new AppError('Ad not found', 404);

  const baseUrl          = `${req.protocol}://${req.get('host')}`;
  const imageEndpointUrl = adRows[0].image_url ? `${baseUrl}/api/ads/${adId}/image` : null;

  let layoutJson;

  if (mode === 'editable') {
    // Check cache first
    const cached = await getEditableLayout(adId);
    if (cached && cached.editable_json) {
      layoutJson = cached.editable_json;
      console.log(`[layouts/export] editable cache hit for ad=${adId}`);
    } else {
      // Need ad image for vision analysis
      if (!adRows[0].image_url) throw new AppError('Ad has no generated image — generate the ad first', 400);

      // Look up brand for context
      const { rows: brandRows } = await query(
        `SELECT b.* FROM brands b
         JOIN generated_ads a ON a.brand_id = b.id
         WHERE a.id = $1`,
        [adId]
      );
      const brand = brandRows[0] || {};

      console.log(`[layouts/export] running vision analysis for ad=${adId}`);
      layoutJson = await analyzeAdLayout(adRows[0], brand);
      await saveEditableLayout(adId, layoutJson);
    }

    // Inject flat image reference URL so plugin can optionally show locked reference
    if (imageEndpointUrl) {
      layoutJson = Object.assign({}, layoutJson, { flat_image_url: imageEndpointUrl });
    }
  } else {
    // Fast mode — use stored layout_json
    const layout = await getLayoutByAdId(adId);
    if (!layout) throw new AppError('No layout found for this ad', 404);
    layoutJson = JSON.parse(JSON.stringify(layout.layout_json));
  }

  // Inject image_url into every IMAGE layer
  if (imageEndpointUrl && Array.isArray(layoutJson.layers)) {
    layoutJson.layers = layoutJson.layers.map(layer => {
      if (layer.type === 'IMAGE') return Object.assign({}, layer, { image_url: imageEndpointUrl });
      return layer;
    });
  }

  const suffix   = mode === 'editable' ? '-editable' : '';
  const filename = `creative-layout-${adId.slice(0, 8)}${suffix}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(layoutJson, null, 2));
}));

module.exports = router;
