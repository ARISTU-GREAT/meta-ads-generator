const express = require('express');
const router  = express.Router({ mergeParams: true }); // mergeParams for :id from parent
const { asyncHandler, AppError } = require('../utils/errors');
const { getLayoutByAdId }        = require('../services/layoutService');
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

// GET /api/ads/:id/layout/export
// Returns the layout JSON as a downloadable .json file (Figma plugin import)
router.get('/export', asyncHandler(async (req, res) => {
  const adId = req.params.id;
  if (!adId) throw new AppError('ad id required', 400);

  const { rows: adRows } = await query('SELECT id FROM generated_ads WHERE id = $1', [adId]);
  if (!adRows.length) throw new AppError('Ad not found', 404);

  const layout = await getLayoutByAdId(adId);
  if (!layout) throw new AppError('No layout found for this ad', 404);

  const filename = `creative-layout-${adId.slice(0, 8)}.json`;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(JSON.stringify(layout.layout_json, null, 2));
}));

module.exports = router;
