const express       = require('express');
const router        = express.Router();
const uploadService = require('../services/uploadService');
const { asyncHandler, AppError } = require('../utils/errors');

// POST /api/upload/assets — multi-file brand asset upload (frontend Assets tab)
router.post('/assets', uploadService.multipleMiddleware(), asyncHandler(async (req, res) => {
  const { brand_id, asset_type } = req.body;
  const files = req.files;

  console.log('[upload/assets] hit | files:', files?.length ?? 0,
              '| brandId:', brand_id || 'none',
              '| user:', req.session?.user_id || 'unauthenticated');

  if (!brand_id)         throw new AppError('brandId is required', 400);
  if (!files?.length)    throw new AppError('No files uploaded', 400);

  const assets = await uploadService.processUploads(files, brand_id, asset_type || 'image');
  res.status(201).json({ success: true, assets });
}));

// DELETE /api/upload/assets/:assetId — remove a brand asset
router.delete('/assets/:assetId', asyncHandler(async (req, res) => {
  console.log('[upload/assets] delete | assetId:', req.params.assetId,
              '| user:', req.session?.user_id || 'unauthenticated');
  await uploadService.deleteAsset(req.params.assetId);
  res.json({ success: true });
}));

// POST /api/upload — single file (used by generation pipeline for reference images)
router.post('/', uploadService.middleware(), asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('No file provided', 400);
  const results = await uploadService.processUploads([req.file], req.body.brand_id, req.body.asset_type || 'image');
  res.status(201).json({ success: true, data: results[0] });
}));

// POST /api/upload/multiple
router.post('/multiple', uploadService.multipleMiddleware(), asyncHandler(async (req, res) => {
  if (!req.files?.length) throw new AppError('No files provided', 400);
  const results = await uploadService.processUploads(req.files, req.body.brand_id, req.body.asset_type || 'image');
  res.status(201).json({ success: true, data: results });
}));

module.exports = router;
