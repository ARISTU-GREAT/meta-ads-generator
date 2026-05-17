const express       = require('express');
const router        = express.Router();
const uploadService = require('../services/uploadService');
const { asyncHandler, AppError } = require('../utils/errors');

// POST /api/upload  — single file
router.post('/', uploadService.middleware(), asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('No file provided', 400);
  const results = await uploadService.processUploads([req.file], req.body.brand_id, req.body.asset_type || 'image');
  res.status(201).json({ success: true, data: results[0] });
}));

// POST /api/upload/multiple  — up to 20 files
router.post('/multiple', uploadService.multipleMiddleware(), asyncHandler(async (req, res) => {
  if (!req.files || !req.files.length) throw new AppError('No files provided', 400);
  const results = await uploadService.processUploads(req.files, req.body.brand_id, req.body.asset_type || 'image');
  res.status(201).json({ success: true, data: results });
}));

// DELETE /api/upload/:assetId
router.delete('/:assetId', asyncHandler(async (req, res) => {
  await uploadService.deleteAsset(req.params.assetId);
  res.json({ success: true, message: 'Asset deleted' });
}));

module.exports = router;
