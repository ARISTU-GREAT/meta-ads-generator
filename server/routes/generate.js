const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { asyncHandler, AppError }   = require('../utils/errors');
const { isBrandSetupComplete }     = require('../utils/brandKit');
const { TEMP_DIR }                 = require('../utils/paths');
const { query }                    = require('../db');
const generationService            = require('../services/generationService');
const { resolveImage }             = require('../utils/assetResolver');

const upload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per file
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new AppError('Invalid file type. Use JPG, PNG, or WebP.', 400), false);
    }
  },
});

function cleanTempFiles(...paths) {
  paths.forEach(p => {
    try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch {}
  });
}

// POST /api/generate/remix
// Body: multipart/form-data
//   brand_id             — UUID (required)
//   reference_image      — file  (required unless reference_asset_id)
//   reference_asset_id   — UUID  (required unless reference_image)
//   product_image        — file  (required unless product_asset_id)
//   product_asset_id     — UUID  (required unless product_image)
//   instructions         — string (optional)
//   aspect_ratio         — 'square' | 'portrait' | 'landscape'
//   count                — 1–20 (default: 5)
router.post(
  '/remix',
  upload.fields([
    { name: 'reference_image', maxCount: 1 },
    { name: 'product_image',   maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const { brand_id, instructions, aspect_ratio, count, reference_asset_id, product_asset_id } = req.body;
    const n = parseInt(count, 10) || 5;
    if (n < 1 || n > 20) throw new AppError('count must be between 1 and 20', 400);
    if (!brand_id) throw new AppError('brand_id is required', 400);

    const { rows: brandRows } = await query('SELECT * FROM brands WHERE id = $1 AND is_active = true', [brand_id]);
    if (!brandRows.length) throw new AppError('Brand not found', 404);
    const kitCheck = isBrandSetupComplete(brandRows[0]);
    if (!kitCheck.complete) {
      throw new AppError('Brand Setup incomplete. Complete Brand Setup before generating ads.', 400, { required_fields: kitCheck.missing_labels });
    }

    const [refResolved, prodResolved] = await Promise.all([
      resolveImage(req.files?.reference_image?.[0], reference_asset_id, 'reference_image'),
      resolveImage(req.files?.product_image?.[0],   product_asset_id,   'product_image'),
    ]);

    let result;
    try {
      result = await generationService.remixGenerateBatch({
        brandId:            brand_id,
        referenceImagePath: refResolved.path,
        productImagePath:   prodResolved.path,
        referenceImageMime: refResolved.mime,
        productImageMime:   prodResolved.mime,
        instructions:       instructions || '',
        aspectRatio:        aspect_ratio || 'square',
        count:              n,
      });
    } finally {
      refResolved.cleanup();
      prodResolved.cleanup();
    }

    res.status(201).json({ success: true, data: result });
  })
);

// POST /api/generate/remix/stream
// Same inputs as /remix but response is SSE — each image fires an event as it completes
// This enables the live generation board (cards appear progressively)
router.post(
  '/remix/stream',
  upload.fields([
    { name: 'reference_image', maxCount: 1 },
    { name: 'product_image',   maxCount: 1 },
  ]),
  async (req, res) => {
    // Set SSE headers immediately after upload completes
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (data) => {
      if (!res.writableEnded) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    const { brand_id, instructions, aspect_ratio, count, campaign_id, speed_mode,
            reference_asset_id, product_asset_id } = req.body;
    const n = parseInt(count, 10) || 5;

    if (!brand_id) {
      sendEvent({ type: 'error', message: 'brand_id is required' });
      return res.end();
    }
    if (n < 1 || n > 20) {
      sendEvent({ type: 'error', message: 'count must be between 1 and 20 per request' });
      return res.end();
    }

    const { rows: brandRows } = await query('SELECT * FROM brands WHERE id = $1 AND is_active = true', [brand_id]);
    if (!brandRows.length) {
      sendEvent({ type: 'error', message: 'Brand not found' });
      return res.end();
    }
    const kitCheck = isBrandSetupComplete(brandRows[0]);
    if (!kitCheck.complete) {
      sendEvent({ type: 'error', message: 'Brand Setup incomplete. Complete Brand Setup before generating ads.', required_fields: kitCheck.missing_labels });
      return res.end();
    }

    let refResolved, prodResolved;
    try {
      [refResolved, prodResolved] = await Promise.all([
        resolveImage(req.files?.reference_image?.[0], reference_asset_id, 'reference_image'),
        resolveImage(req.files?.product_image?.[0],   product_asset_id,   'product_image'),
      ]);
    } catch (err) {
      sendEvent({ type: 'error', message: err.message });
      return res.end();
    }

    sendEvent({ type: 'start', count: n });

    try {
      const result = await generationService.remixGenerateBatchStream({
        brandId:            brand_id,
        referenceImagePath: refResolved.path,
        productImagePath:   prodResolved.path,
        referenceImageMime: refResolved.mime,
        productImageMime:   prodResolved.mime,
        instructions:       instructions || '',
        aspectRatio:        aspect_ratio || 'square',
        count:              n,
        campaignId:         campaign_id  || null,
        speedMode:          speed_mode   || 'balanced',
        onProgress:         (item) => sendEvent(item),
      });

      sendEvent({
        type:             'done',
        batch_id:         result.batch_id,
        count:            n,
        speed_mode:       result.speed_mode,
        generation_time:  result.actual_generation_time_seconds,
        creativeStrategy: result.creativeStrategy,
      });
    } catch (err) {
      console.error('[generate/stream] fatal error:', err.message);
      sendEvent({ type: 'error', message: err.message });
    } finally {
      refResolved?.cleanup();
      prodResolved?.cleanup();
      if (!res.writableEnded) res.end();
    }
  }
);

module.exports = router;
