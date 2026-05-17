const { query }    = require('../db');
const { AppError } = require('../utils/errors');

const VALID_TYPES = ['generate_copy', 'generate_image', 'generate_full_ad', 'batch'];

const getJobs = async ({ brand_id, status, limit = 20, offset = 0 }) => {
  const params = [];
  let sql = `SELECT j.*, c.title AS concept_title
             FROM generation_jobs j
             LEFT JOIN concepts c ON j.concept_id = c.id
             WHERE 1=1`;

  if (brand_id) { params.push(brand_id); sql += ` AND j.brand_id = $${params.length}`; }
  if (status)   { params.push(status);   sql += ` AND j.status   = $${params.length}`; }

  params.push(limit, offset);
  sql += ` ORDER BY j.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const { rows } = await query(sql, params);
  return rows;
};

const getJobById = async (id) => {
  const { rows } = await query(
    `SELECT j.*, c.title AS concept_title
     FROM generation_jobs j
     LEFT JOIN concepts c ON j.concept_id = c.id
     WHERE j.id = $1`,
    [id]
  );
  if (!rows.length) return null;

  const job = rows[0];
  const adsResult = await query(
    'SELECT * FROM generated_ads WHERE job_id = $1 ORDER BY created_at DESC',
    [id]
  );
  job.generated_ads = adsResult.rows;
  return job;
};

const createJob = async (data) => {
  const { brand_id, concept_id, job_type, priority, batch_size, input_params } = data;
  if (!brand_id || !job_type) throw new AppError('brand_id and job_type are required', 400);
  if (!VALID_TYPES.includes(job_type)) throw new AppError(`Invalid job_type. Allowed: ${VALID_TYPES.join(', ')}`, 400);

  const { rows } = await query(
    `INSERT INTO generation_jobs (brand_id, concept_id, job_type, priority, batch_size, input_params)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [brand_id, concept_id, job_type, priority || 5, batch_size || 1, JSON.stringify(input_params || {})]
  );

  // AI pipeline hook — plug generation engine here:
  // await pipeline.enqueue(rows[0]);

  return rows[0];
};

const cancelJob = async (id) => {
  const { rows } = await query(
    `UPDATE generation_jobs SET status = 'cancelled'
     WHERE id = $1 AND status IN ('queued', 'processing') RETURNING *`,
    [id]
  );
  if (!rows.length) throw new AppError('Job not found or cannot be cancelled', 400);
  return rows[0];
};

const retryJob = async (id) => {
  const { rows } = await query(
    `UPDATE generation_jobs
     SET status = 'queued', error_message = NULL, failed_count = 0,
         started_at = NULL, completed_at = NULL
     WHERE id = $1 AND status = 'failed' RETURNING *`,
    [id]
  );
  if (!rows.length) throw new AppError('Job not found or not in failed state', 400);
  return rows[0];
};

module.exports = { getJobs, getJobById, createJob, cancelJob, retryJob };
