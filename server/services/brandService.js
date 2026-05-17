const { query } = require('../db');
const { AppError } = require('../utils/errors');

const getAllBrands = async () => {
  const { rows } = await query('SELECT * FROM brands WHERE is_active = true ORDER BY name ASC');
  return rows;
};

const getBrandById = async (id) => {
  const { rows } = await query(
    'SELECT * FROM brands WHERE id = $1 AND is_active = true',
    [id]
  );
  return rows[0] || null;
};

const createBrand = async (data) => {
  const { name, description, primary_color, secondary_color, website_url, industry,
          target_audience, brand_voice, offer_cta,
          primary_font, secondary_font, headline_style, typography_personality } = data;
  if (!name) throw new AppError('Brand name is required', 400);

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const { rows } = await query(
    `INSERT INTO brands
       (name, slug, description, primary_color, secondary_color, website_url, industry,
        target_audience, brand_voice, offer_cta,
        primary_font, secondary_font, headline_style, typography_personality)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [name, slug, description, primary_color, secondary_color, website_url, industry,
     target_audience || null, brand_voice || null, offer_cta || null,
     primary_font || null, secondary_font || null, headline_style || null, typography_personality || null]
  );
  return rows[0];
};

const updateBrand = async (id, data) => {
  const { name, description, primary_color, secondary_color, logo_url, website_url,
          industry, metadata, target_audience, brand_voice, offer_cta,
          primary_font, secondary_font, headline_style, typography_personality } = data;

  const { rows } = await query(
    `UPDATE brands SET
       name                   = COALESCE($1,  name),
       description            = COALESCE($2,  description),
       primary_color          = COALESCE($3,  primary_color),
       secondary_color        = COALESCE($4,  secondary_color),
       logo_url               = COALESCE($5,  logo_url),
       website_url            = COALESCE($6,  website_url),
       industry               = COALESCE($7,  industry),
       metadata               = COALESCE($8,  metadata),
       target_audience        = COALESCE($9,  target_audience),
       brand_voice            = COALESCE($10, brand_voice),
       offer_cta              = COALESCE($11, offer_cta),
       primary_font           = $12,
       secondary_font         = $13,
       headline_style         = $14,
       typography_personality = $15
     WHERE id = $16 AND is_active = true RETURNING *`,
    [name       || null,
     description || null,
     primary_color   || null,
     secondary_color || null,
     logo_url    || null,
     website_url || null,
     industry    || null,
     metadata    ? JSON.stringify(metadata) : null,
     target_audience || null,
     brand_voice     || null,
     offer_cta       || null,
     primary_font           || null,
     secondary_font         || null,
     headline_style         || null,
     typography_personality || null,
     id]
  );
  return rows[0] || null;
};

const deactivateBrand = async (id) => {
  await query('UPDATE brands SET is_active = false WHERE id = $1', [id]);
};

const getBrandAssets = async (brandId, assetType = null) => {
  const params = [brandId];
  let sql = 'SELECT * FROM brand_assets WHERE brand_id = $1';
  if (assetType) { params.push(assetType); sql += ` AND asset_type = $${params.length}`; }
  sql += ' ORDER BY created_at DESC';
  const { rows } = await query(sql, params);
  return rows.map(row => ({
    ...row,
    url: row.file_url || (row.file_path
      ? '/' + row.file_path.replace(/\\/g, '/').replace(/^server\//, '')
      : null),
  }));
};

const getBrandPersonas = async (brandId) => {
  const { rows } = await query(
    'SELECT * FROM brand_personas WHERE brand_id = $1 ORDER BY is_default DESC, name ASC',
    [brandId]
  );
  return rows;
};

const createPersona = async (brandId, data) => {
  const { name, age_range, gender, interests, pain_points, goals, income_range, location, description, is_default } = data;
  if (!name) throw new AppError('Persona name is required', 400);

  const { rows } = await query(
    `INSERT INTO brand_personas
       (brand_id, name, age_range, gender, interests, pain_points, goals, income_range, location, description, is_default)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [brandId, name, age_range, gender, interests || [], pain_points || [], goals || [],
     income_range, location, description, is_default || false]
  );
  return rows[0];
};

module.exports = {
  getAllBrands, getBrandById, createBrand, updateBrand, deactivateBrand,
  getBrandAssets, getBrandPersonas, createPersona,
};
