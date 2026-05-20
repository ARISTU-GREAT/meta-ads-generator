const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const fs       = require('fs');
const OpenAI   = require('openai');
const { query }    = require('../db');
const { asyncHandler, AppError } = require('../utils/errors');
const { isBrandSetupComplete } = require('../utils/brandKit');
const { generateConceptPlan, formatsData } = require('../services/conceptPlanService');

const { TEMP_DIR } = require('../utils/paths');

// Allow up to 20 MB per uploaded product image (client compresses first, but keep headroom)
const upload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) cb(null, true);
    else cb(new AppError('Invalid file type. Use JPG, PNG, or WebP.', 400), false);
  },
});

let _openai = null;
function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new AppError('OPENAI_API_KEY not configured on the server', 500);
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// GET /api/concepts/formats — return the full format library
router.get('/formats', (_req, res) => {
  res.json({ success: true, data: formatsData });
});

// POST /api/concepts/plan
// Body: multipart/form-data
//   brand_id          — UUID (required)
//   product_image     — file  (optional; compressed to ≤1024px by client before upload)
//   product_asset_id  — UUID  (optional; use instead of uploading a file)
//   strategy          — string (optional)
//   concept_count     — 1–12 (default 5)
//   aspect_ratio      — square | portrait | landscape
//   format_ids        — JSON array of selected format ids (optional)
router.post(
  '/plan',
  upload.single('product_image'),
  asyncHandler(async (req, res) => {
    const { brand_id, strategy, concept_count, aspect_ratio, format_ids, product_asset_id } = req.body;

    // ── Pre-flight validation ────────────────────────────────────
    if (!brand_id) throw new AppError('brand_id is required', 400);
    if (!process.env.OPENAI_API_KEY) {
      throw new AppError('OpenAI API key is not configured on the server. Contact your administrator.', 500);
    }

    const openai = getOpenAI();

    const [brandRes, personasRes] = await Promise.all([
      query(`SELECT * FROM brands WHERE id = $1`, [brand_id]),
      query(`SELECT * FROM brand_personas WHERE brand_id = $1 ORDER BY is_default DESC, created_at`, [brand_id]),
    ]);
    if (!brandRes.rows.length) throw new AppError('Brand not found', 404);
    const brand = brandRes.rows[0];

    const kitCheck = isBrandSetupComplete(brand);
    if (!kitCheck.complete) {
      throw new AppError('Brand Setup incomplete. Complete Brand Setup before planning concepts.', 400, { required_fields: kitCheck.missing_labels });
    }

    // ── Resolve product image ─────────────────────────────────────
    // Preferred path: uploaded file (already compressed to ≤1024px by browser).
    // Asset path: read data URL directly from DB — no temp-file write/read roundtrip.
    let productImagePath     = null;
    let productImageMime     = null;
    let productImageDataUrl  = null; // used when asset comes from DB
    let cleanupUploadedFile  = () => {};

    if (req.file) {
      // Uploaded file — check it isn't suspiciously large after compression
      const fileSizeKB = req.file.size / 1024;
      if (fileSizeKB > 8 * 1024) {
        try { fs.unlinkSync(req.file.path); } catch {}
        throw new AppError(
          'Image too large. Please use a smaller image or an uploaded brand asset. (max ~8 MB after compression)',
          413
        );
      }
      productImagePath = req.file.path;
      productImageMime = req.file.mimetype;
      cleanupUploadedFile = () => {
        try { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch {}
      };
    } else if (product_asset_id) {
      // Asset path: pull data URL straight from DB, skip temp file entirely
      try {
        const { rows: assetRows } = await query(
          'SELECT file_url, mime_type FROM brand_assets WHERE id = $1',
          [product_asset_id]
        );
        if (!assetRows.length || !assetRows[0].file_url) {
          throw new AppError(`Asset ${product_asset_id} not found`, 404);
        }
        const raw = assetRows[0].file_url;
        // Validate it looks like a data URL
        if (!raw.startsWith('data:')) {
          throw new AppError('Asset image format is not supported (expected base64 data URL)', 500);
        }
        // Guard: reject if base64 payload > ~6 MB (≈ 4.5 MB raw image) to avoid oversized OpenAI requests
        const b64Len = raw.length - raw.indexOf(',') - 1;
        if (b64Len > 6 * 1024 * 1024) {
          throw new AppError(
            'Brand asset image is too large to use for concept planning. Please upload a smaller product image instead.',
            413
          );
        }
        productImageDataUrl = raw;
        productImageMime    = assetRows[0].mime_type || raw.match(/^data:([^;]+)/)?.[1] || 'image/jpeg';
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError(`Could not load product asset: ${err.message}`, 400);
      }
    }

    let selectedFormatIds = null;
    try {
      if (format_ids) selectedFormatIds = JSON.parse(format_ids);
    } catch {
      throw new AppError('format_ids must be a valid JSON array', 400);
    }

    const conceptCount = parseInt(concept_count, 10) || 5;
    const ratioValue   = aspect_ratio || 'square';
    const model        = process.env.OPENAI_PROMPT_MODEL || 'gpt-4.1-mini';

    const debugCtx = {
      brand_id,
      concept_count:      conceptCount,
      aspect_ratio:       ratioValue,
      model,
      image_source:       req.file ? 'upload' : product_asset_id ? 'asset' : 'none',
      format_ids_count:   selectedFormatIds?.length ?? null,
    };

    console.log('[concepts/plan] starting', debugCtx);

    // ── Generate plan ─────────────────────────────────────────────
    let plan;
    try {
      plan = await generateConceptPlan({
        openai,
        brand,
        personas:            personasRes.rows,
        productImagePath,
        productImageMime,
        productImageDataUrl, // takes priority over path when set
        strategy:            strategy || '',
        conceptCount,
        aspectRatio:         ratioValue,
        selectedFormatIds,
      });
    } catch (err) {
      console.error('[concepts/plan] failed', {
        message: err.message,
        ...debugCtx,
        stack: err.stack?.split('\n').slice(0, 5).join(' | '),
      });
      throw new AppError(
        err.message || 'Concept planning failed — check server logs for details',
        err.status || err.statusCode || 500
      );
    } finally {
      cleanupUploadedFile();
    }

    console.log('[concepts/plan] completed', { concepts: plan.length, ...debugCtx });

    const responseBody = { success: true, data: plan };
    if (process.env.NODE_ENV !== 'production') responseBody.debug = debugCtx;
    res.json(responseBody);
  })
);

module.exports = router;
