const { query }    = require('../db');
const { AppError } = require('../utils/errors');

const getAds = async ({ brand_id, status, concept_id, limit = 20, offset = 0 }) => {
  const params = [];
  let sql = `SELECT ga.*, c.title AS concept_title
             FROM generated_ads ga
             LEFT JOIN concepts c ON ga.concept_id = c.id
             WHERE 1=1`;

  if (brand_id)   { params.push(brand_id);   sql += ` AND ga.brand_id   = $${params.length}`; }
  if (status)     { params.push(status);     sql += ` AND ga.status     = $${params.length}`; }
  if (concept_id) { params.push(concept_id); sql += ` AND ga.concept_id = $${params.length}`; }

  params.push(limit, offset);
  sql += ` ORDER BY ga.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const { rows } = await query(sql, params);
  return rows;
};

const getAdById = async (id) => {
  const { rows } = await query(
    `SELECT ga.*, c.title AS concept_title
     FROM generated_ads ga
     LEFT JOIN concepts c ON ga.concept_id = c.id
     WHERE ga.id = $1`,
    [id]
  );
  return rows[0] || null;
};

const updateAdStatus = async (id, status, feedback) => {
  const valid = ['draft', 'approved', 'rejected', 'exported'];
  if (!valid.includes(status)) throw new AppError('Invalid status', 400);

  const { rows } = await query(
    `UPDATE generated_ads SET status = $1, feedback = COALESCE($2, feedback)
     WHERE id = $3 RETURNING *`,
    [status, feedback, id]
  );
  if (!rows.length) throw new AppError('Ad not found', 404);
  return rows[0];
};

const deleteAd = async (id) => {
  await query('DELETE FROM generated_ads WHERE id = $1', [id]);
};

const getConcepts = async ({ brand_id, status } = {}) => {
  const params = [];
  let sql = 'SELECT * FROM concepts WHERE 1=1';
  if (brand_id) { params.push(brand_id); sql += ` AND brand_id = $${params.length}`; }
  if (status)   { params.push(status);   sql += ` AND status   = $${params.length}`; }
  sql += ' ORDER BY created_at DESC';
  const { rows } = await query(sql, params);
  return rows;
};

const createConcept = async (data) => {
  const { brand_id, persona_id, template_id, title, objective, product_name,
          key_benefit, tone, hook_type, platform, ad_format, additional_context } = data;
  if (!brand_id || !title) throw new AppError('brand_id and title are required', 400);

  const { rows } = await query(
    `INSERT INTO concepts
       (brand_id, persona_id, template_id, title, objective, product_name,
        key_benefit, tone, hook_type, platform, ad_format, additional_context)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [brand_id, persona_id, template_id, title, objective, product_name,
     key_benefit, tone, hook_type, platform || 'meta', ad_format || 'single_image', additional_context]
  );
  return rows[0];
};

const getReferenceAds = async (brandId) => {
  const params = brandId ? [brandId] : [];
  const sql = brandId
    ? 'SELECT * FROM reference_ads WHERE brand_id = $1 ORDER BY created_at DESC'
    : 'SELECT * FROM reference_ads ORDER BY created_at DESC';
  const { rows } = await query(sql, params);
  return rows;
};

const createReferenceAd = async (data) => {
  const { brand_id, title, platform, ad_format, headline, body_text,
          cta, image_url, file_path, performance_score, tags, notes } = data;
  if (!brand_id) throw new AppError('brand_id is required', 400);

  const { rows } = await query(
    `INSERT INTO reference_ads
       (brand_id, title, platform, ad_format, headline, body_text, cta,
        image_url, file_path, performance_score, tags, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [brand_id, title, platform || 'meta', ad_format, headline, body_text, cta,
     image_url, file_path, performance_score, tags || [], notes]
  );
  return rows[0];
};

module.exports = {
  getAds, getAdById, updateAdStatus, deleteAd,
  getConcepts, createConcept, getReferenceAds, createReferenceAd,
};
