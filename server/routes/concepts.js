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
  if (!process.env.OPENAI_API_KEY) throw new AppError('OPENAI_API_KEY not configured', 500);
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
    if (!brand_id) throw new AppError('brand_id is required', 400);

    const openai = getOpenAI();

    const [brandRes, personasRes] = await Promise.all([
      query(`SELECT * FROM brands WHERE id = $1`, [brand_id]),
      query(`SELECT * FROM brand_personas WHERE brand_id = $1 ORDER BY is_default DESC, created_at`, [brand_id]),
    ]);
    if (!brandRes.rows.length) throw new AppError('Brand not found', 404);
    const kitCheck = isBrandSetupComplete(brandRes.rows[0]);
    if (!kitCheck.complete) {
      throw new AppError('Brand Setup incomplete. Complete Brand Setup before generating ads.', 400, { required_fields: kitCheck.missing_labels });
    }

    // Resolve product image: uploaded file takes priority; fall back to saved asset
    let productResolved = null;
    if (req.file) {
      productResolved = { path: req.file.path, mime: req.file.mimetype, cleanup() {} };
    } else if (product_asset_id) {
      productResolved = await resolveAssetToFile(product_asset_id);
    }

    let selectedFormatIds = null;
    try {
      if (format_ids) selectedFormatIds = JSON.parse(format_ids);
    } catch {}

    let plan;
    try {
      plan = await generateConceptPlan({
        openai,
        brand:            brandRes.rows[0],
        personas:         personasRes.rows,
        productImagePath: productResolved?.path  || null,
        productImageMime: productResolved?.mime || null,
        strategy:         strategy    || '',
        conceptCount:     parseInt(concept_count, 10) || 5,
        aspectRatio:      aspect_ratio || 'square',
        selectedFormatIds,
      });
    } finally {
      productResolved?.cleanup();
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try { fs.unlinkSync(req.file.path); } catch {}
      }
    }

    res.json({ success: true, data: plan });
  })
);

module.exports = router;
