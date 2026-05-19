const express  = require('express');
const router   = express.Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const OpenAI   = require('openai');
const { query }    = require('../db');
const { asyncHandler, AppError } = require('../utils/errors');
const { isBrandSetupComplete } = require('../utils/brandKit');
const { generateConceptPlan, formatsData } = require('../services/conceptPlanService');
const { resolveAssetToFile } = require('../utils/assetResolver');

const { TEMP_DIR } = require('../utils/paths');

const upload = multer({
  dest: TEMP_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
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

// POST /api/concepts/plan — AI-generate a concept plan
// Body: multipart/form-data
//   brand_id       — UUID (required)
//   product_image  — file (optional but strongly recommended)
//   strategy       — string (optional)
//   concept_count  — number (1–12, default 5)
//   aspect_ratio   — square | portrait | landscape
//   format_ids     — JSON array of selected format ids (optional, leave blank for AI choice)
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

    let openai;
    try {
      openai = getOpenAI();
    } catch (err) {
      throw new AppError(err.message, 500);
    }

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

    // ── Resolve product image ────────────────────────────────────
    let productResolved = null;
    if (req.file) {
      productResolved = { path: req.file.path, mime: req.file.mimetype, cleanup() {} };
    } else if (product_asset_id) {
      try {
        productResolved = await resolveAssetToFile(product_asset_id);
      } catch (err) {
        throw new AppError(`Could not load product image: ${err.message}`, 400);
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
      concept_count: conceptCount,
      aspect_ratio:  ratioValue,
      model,
      has_product_image: !!productResolved,
      format_ids_count:  selectedFormatIds?.length ?? null,
    };

    console.log('[concepts/plan] starting concept plan', debugCtx);

    // ── Generate plan ─────────────────────────────────────────────
    let plan;
    try {
      plan = await generateConceptPlan({
        openai,
        brand,
        personas:         personasRes.rows,
        productImagePath: productResolved?.path || null,
        productImageMime: productResolved?.mime || null,
        strategy:         strategy    || '',
        conceptCount,
        aspectRatio:      ratioValue,
        selectedFormatIds,
      });
    } catch (err) {
      console.error('[concepts/plan] generateConceptPlan failed', {
        message: err.message,
        ...debugCtx,
        stack: err.stack?.split('\n').slice(0, 5).join(' | '),
      });
      // Re-throw with a clear message so the client sees it
      throw new AppError(
        err.message || 'Concept planning failed — check server logs for details',
        err.status || err.statusCode || 500
      );
    } finally {
      productResolved?.cleanup();
      if (req.file?.path) {
        try { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); } catch {}
      }
    }

    console.log('[concepts/plan] completed', { concepts: plan.length, ...debugCtx });

    const responseBody = { success: true, data: plan };
    if (process.env.NODE_ENV !== 'production') {
      responseBody.debug = debugCtx;
    }
    res.json(responseBody);
  })
);

module.exports = router;
