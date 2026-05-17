const express = require('express');
const router  = express.Router();
const { query }    = require('../db');
const { asyncHandler, AppError } = require('../utils/errors');

// GET /api/campaigns?brand_id=...
router.get('/', asyncHandler(async (req, res) => {
  const { brand_id } = req.query;
  if (!brand_id) throw new AppError('brand_id is required', 400);

  const { rows } = await query(
    `SELECT c.*,
            COUNT(ga.id)::int AS ad_count
     FROM campaigns c
     LEFT JOIN generated_ads ga ON ga.campaign_id = c.id
     WHERE c.brand_id = $1
     GROUP BY c.id
     ORDER BY c.created_at DESC`,
    [brand_id]
  );
  res.json({ success: true, data: rows });
}));

// POST /api/campaigns
router.post('/', asyncHandler(async (req, res) => {
  const { brand_id, name, mode } = req.body;
  if (!brand_id || !name) throw new AppError('brand_id and name are required', 400);

  const { rows } = await query(
    `INSERT INTO campaigns (brand_id, name, mode) VALUES ($1, $2, $3) RETURNING *`,
    [brand_id, name, mode || 'remix']
  );
  res.status(201).json({ success: true, data: rows[0] });
}));

// GET /api/campaigns/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query(`SELECT * FROM campaigns WHERE id = $1`, [req.params.id]);
  if (!rows.length) throw new AppError('Campaign not found', 404);
  res.json({ success: true, data: rows[0] });
}));

// GET /api/campaigns/:id/ads
router.get('/:id/ads', asyncHandler(async (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  const { rows } = await query(
    `SELECT * FROM generated_ads WHERE campaign_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
    [req.params.id, parseInt(limit, 10), parseInt(offset, 10)]
  );
  res.json({ success: true, data: rows });
}));

// PUT /api/campaigns/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const { name, status, mode } = req.body;
  const { rows } = await query(
    `UPDATE campaigns
     SET name   = COALESCE($1, name),
         status = COALESCE($2, status),
         mode   = COALESCE($3, mode)
     WHERE id = $4 RETURNING *`,
    [name || null, status || null, mode || null, req.params.id]
  );
  if (!rows.length) throw new AppError('Campaign not found', 404);
  res.json({ success: true, data: rows[0] });
}));

module.exports = router;
