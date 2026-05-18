const express      = require('express');
const router       = express.Router();
const brandService = require('../services/brandService');
const { asyncHandler } = require('../utils/errors');
const memoryRouter = require('./memory');
const { logEvent } = require('../services/auditService');

// GET /api/brands
router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await brandService.getAllBrands() });
}));

// GET /api/brands/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const brand = await brandService.getBrandById(req.params.id);
  if (!brand) return res.status(404).json({ success: false, error: 'Brand not found' });
  res.json({ success: true, data: brand });
}));

// POST /api/brands
router.post('/', asyncHandler(async (req, res) => {
  const brand = await brandService.createBrand(req.body);
  logEvent(req, { event_type: 'brand_created', entity_type: 'brand', entity_id: brand.id, message: 'Brand created: ' + brand.name }).catch(() => {});
  res.status(201).json({ success: true, data: brand });
}));

// PUT /api/brands/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const brand = await brandService.updateBrand(req.params.id, req.body);
  if (!brand) return res.status(404).json({ success: false, error: 'Brand not found' });
  logEvent(req, { event_type: 'brand_updated', entity_type: 'brand', entity_id: brand.id, message: 'Brand updated: ' + brand.name }).catch(() => {});
  res.json({ success: true, data: brand });
}));

// DELETE /api/brands/:id  (soft delete)
router.delete('/:id', asyncHandler(async (req, res) => {
  await brandService.deactivateBrand(req.params.id);
  logEvent(req, { event_type: 'brand_deleted', entity_type: 'brand', entity_id: req.params.id }).catch(() => {});
  res.json({ success: true, message: 'Brand deactivated' });
}));

// GET /api/brands/:id/assets
router.get('/:id/assets', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await brandService.getBrandAssets(req.params.id, req.query.type) });
}));

// GET /api/brands/:id/personas
router.get('/:id/personas', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await brandService.getBrandPersonas(req.params.id) });
}));

// POST /api/brands/:id/personas
router.post('/:id/personas', asyncHandler(async (req, res) => {
  const persona = await brandService.createPersona(req.params.id, req.body);
  res.status(201).json({ success: true, data: persona });
}));

// Memory routes — /api/brands/:brandId/memory[/...]
router.use('/:brandId/memory', memoryRouter);

module.exports = router;
