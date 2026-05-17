const express   = require('express');
const router    = express.Router();
const adService = require('../services/adService');
const { asyncHandler } = require('../utils/errors');

// GET /api/ads — filterable list
router.get('/', asyncHandler(async (req, res) => {
  const { brand_id, status, concept_id, limit = 20, offset = 0 } = req.query;
  const ads = await adService.getAds({ brand_id, status, concept_id, limit: +limit, offset: +offset });
  res.json({ success: true, data: ads });
}));

// GET /api/ads/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const ad = await adService.getAdById(req.params.id);
  if (!ad) return res.status(404).json({ success: false, error: 'Ad not found' });
  res.json({ success: true, data: ad });
}));

// PUT /api/ads/:id/status
router.put('/:id/status', asyncHandler(async (req, res) => {
  const { status, feedback } = req.body;
  res.json({ success: true, data: await adService.updateAdStatus(req.params.id, status, feedback) });
}));

// DELETE /api/ads/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  await adService.deleteAd(req.params.id);
  res.json({ success: true, message: 'Ad deleted' });
}));

// GET /api/ads/concepts/list
router.get('/concepts/list', asyncHandler(async (req, res) => {
  const { brand_id, status } = req.query;
  res.json({ success: true, data: await adService.getConcepts({ brand_id, status }) });
}));

// POST /api/ads/concepts
router.post('/concepts', asyncHandler(async (req, res) => {
  const concept = await adService.createConcept(req.body);
  res.status(201).json({ success: true, data: concept });
}));

// GET /api/ads/reference/list
router.get('/reference/list', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await adService.getReferenceAds(req.query.brand_id) });
}));

// POST /api/ads/reference
router.post('/reference', asyncHandler(async (req, res) => {
  const ref = await adService.createReferenceAd(req.body);
  res.status(201).json({ success: true, data: ref });
}));

module.exports = router;
