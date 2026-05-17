const express = require('express');
const router  = express.Router();
const { query } = require('../db');
const { asyncHandler } = require('../utils/errors');

// GET /api/templates
router.get('/', asyncHandler(async (req, res) => {
  const { brand_id, template_type, platform } = req.query;
  const params = [];
  let sql = 'SELECT * FROM templates WHERE is_active = true';

  if (brand_id) {
    params.push(brand_id);
    sql += ` AND (brand_id = $${params.length} OR is_global = true)`;
  } else {
    sql += ' AND is_global = true';
  }

  if (template_type) { params.push(template_type); sql += ` AND template_type = $${params.length}`; }
  if (platform)      { params.push(platform);      sql += ` AND platform      = $${params.length}`; }

  sql += ' ORDER BY is_global DESC, created_at DESC';

  const { rows } = await query(sql, params);
  res.json({ success: true, data: rows });
}));

// GET /api/templates/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM templates WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ success: false, error: 'Template not found' });
  res.json({ success: true, data: rows[0] });
}));

// POST /api/templates
router.post('/', asyncHandler(async (req, res) => {
  const { brand_id, name, description, template_type, platform, ad_format,
          structure, variables, example_output, is_global, tags } = req.body;

  const { rows } = await query(
    `INSERT INTO templates
       (brand_id, name, description, template_type, platform, ad_format,
        structure, variables, example_output, is_global, tags)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [brand_id, name, description, template_type, platform || 'meta', ad_format,
     JSON.stringify(structure || {}), variables || [], example_output, is_global || false, tags || []]
  );
  res.status(201).json({ success: true, data: rows[0] });
}));

// PUT /api/templates/:id
router.put('/:id', asyncHandler(async (req, res) => {
  const { name, description, structure, variables, example_output, is_active, tags } = req.body;

  const { rows } = await query(
    `UPDATE templates SET
       name           = COALESCE($1, name),
       description    = COALESCE($2, description),
       structure      = COALESCE($3, structure),
       variables      = COALESCE($4, variables),
       example_output = COALESCE($5, example_output),
       is_active      = COALESCE($6, is_active),
       tags           = COALESCE($7, tags)
     WHERE id = $8 RETURNING *`,
    [name, description, structure ? JSON.stringify(structure) : null,
     variables, example_output, is_active, tags, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ success: false, error: 'Template not found' });
  res.json({ success: true, data: rows[0] });
}));

// DELETE /api/templates/:id  (soft delete)
router.delete('/:id', asyncHandler(async (req, res) => {
  await query('UPDATE templates SET is_active = false WHERE id = $1', [req.params.id]);
  res.json({ success: true, message: 'Template deactivated' });
}));

module.exports = router;
