const express = require('express');
const router  = express.Router({ mergeParams: true }); // gives access to :brandId from parent
const OpenAI  = require('openai');
const { query }    = require('../db');
const { asyncHandler, AppError } = require('../utils/errors');
const brandMemoryService = require('../services/brandMemoryService');

function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new AppError('OPENAI_API_KEY not configured', 500);
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// GET /api/brands/:brandId/memory[?source_type=...]
router.get('/', asyncHandler(async (req, res) => {
  const { brandId } = req.params;
  const { source_type } = req.query;
  try {
    const params = [brandId];
    let sql = 'SELECT * FROM creative_memories WHERE brand_id = $1';
    if (source_type) { sql += ' AND source_type = $2'; params.push(source_type); }
    sql += ' ORDER BY created_at DESC';
    const { rows } = await query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.warn('[memory/list] table may not exist:', err.message);
    res.json({ success: true, data: [] });
  }
}));

// DELETE /api/brands/:brandId/memory/:memoryId
router.delete('/:memoryId', asyncHandler(async (req, res) => {
  await query(
    'DELETE FROM creative_memories WHERE id = $1 AND brand_id = $2',
    [req.params.memoryId, req.params.brandId]
  );
  res.json({ success: true });
}));

// POST /api/brands/:brandId/memory/manual — save a manual creative note
router.post('/manual', asyncHandler(async (req, res) => {
  const { title, summary, angle, hook, performance_note } = req.body;
  if (!title && !summary) throw new AppError('title or summary is required', 400);
  const mem = await brandMemoryService.saveCreativeMemory({
    brandId:         req.params.brandId,
    sourceType:      'manual_note',
    title, summary, angle, hook,
    performanceNote: performance_note,
  });
  res.status(201).json({ success: true, data: mem });
}));

// POST /api/brands/:brandId/memory/analyze-all-assets
// Batch-analyze all brand image assets and save as reference_ad memories
router.post('/analyze-all-assets', asyncHandler(async (req, res) => {
  const { rows: assets } = await query(
    "SELECT * FROM brand_assets WHERE brand_id = $1 AND mime_type LIKE 'image/%'",
    [req.params.brandId]
  );
  if (!assets.length) throw new AppError('No image assets found for this brand', 404);

  const openai = getOpenAI();
  const results = [];

  for (const asset of assets) {
    if (!asset.file_url) { results.push({ assetId: asset.id, success: false, error: 'No image data' }); continue; }
    try {
      const mem = await brandMemoryService.analyzeAdIntoMemory({
        openai,
        brandId:      req.params.brandId,
        sourceType:   'reference_ad',
        imageUrl:     asset.file_url,
        imageDataUrl: asset.file_url, // stored as data URL
        metadata:     { assetId: asset.id, assetName: asset.name },
      });
      results.push({ assetId: asset.id, success: true, memoryId: mem.id });
    } catch (err) {
      console.error('[memory/analyze-all] asset failed:', asset.id, err.message);
      results.push({ assetId: asset.id, success: false, error: err.message });
    }
  }

  res.json({
    success: true,
    data:    results,
    analyzed: results.filter(r => r.success).length,
    total:    results.length,
  });
}));

// GET /api/brands/:brandId/memory/angles
router.get('/angles', asyncHandler(async (req, res) => {
  try {
    const { rows } = await query(
      "SELECT * FROM angle_library WHERE brand_id = $1 AND status = 'active' ORDER BY created_at DESC",
      [req.params.brandId]
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.warn('[memory/angles] table may not exist:', err.message);
    res.json({ success: true, data: [] });
  }
}));

// POST /api/brands/:brandId/memory/angles/generate
router.post('/angles/generate', asyncHandler(async (req, res) => {
  const { rows: brandRows } = await query('SELECT * FROM brands WHERE id = $1', [req.params.brandId]);
  if (!brandRows.length) throw new AppError('Brand not found', 404);
  const openai  = getOpenAI();
  const angles  = await brandMemoryService.generateNewAngles(openai, req.params.brandId, brandRows[0]);
  res.json({ success: true, data: angles });
}));

// DELETE /api/brands/:brandId/memory/angles/:angleId
router.delete('/angles/:angleId', asyncHandler(async (req, res) => {
  await query(
    "UPDATE angle_library SET status = 'archived' WHERE id = $1 AND brand_id = $2",
    [req.params.angleId, req.params.brandId]
  );
  res.json({ success: true });
}));

module.exports = router;
