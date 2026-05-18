const express = require('express');
const router  = express.Router();
const { query } = require('../db');
const { asyncHandler } = require('../utils/errors');
const { getAuditEvents } = require('../services/auditService');

// All routes in this file are already protected by requireAdmin (mounted in app.js)

// ── GET /api/admin/overview ──────────────────────────────────
// Table counts, today's generation counts, last 20 audit events
router.get('/overview', asyncHandler(async (_req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    usersCount,
    brandsCount,
    campaignsCount,
    generatedAdsCount,
    brandAssetsCount,
    todayGenerations,
    recentAudit,
  ] = await Promise.all([
    query('SELECT COUNT(*) FROM users'),
    query('SELECT COUNT(*) FROM brands WHERE is_active = true'),
    query('SELECT COUNT(*) FROM campaigns'),
    query('SELECT COUNT(*) FROM generated_ads'),
    query('SELECT COUNT(*) FROM brand_assets'),
    query('SELECT COUNT(*) FROM generated_ads WHERE created_at >= $1', [todayStart.toISOString()]),
    query('SELECT id, user_email, event_type, entity_type, brand_id, campaign_id, message, created_at FROM audit_events ORDER BY created_at DESC LIMIT 20'),
  ]);

  res.json({
    success: true,
    data: {
      counts: {
        users:          parseInt(usersCount.rows[0].count, 10),
        brands:         parseInt(brandsCount.rows[0].count, 10),
        campaigns:      parseInt(campaignsCount.rows[0].count, 10),
        generated_ads:  parseInt(generatedAdsCount.rows[0].count, 10),
        brand_assets:   parseInt(brandAssetsCount.rows[0].count, 10),
        today_generations: parseInt(todayGenerations.rows[0].count, 10),
      },
      recent_audit_events: recentAudit.rows,
    },
  });
}));

// ── GET /api/admin/users ─────────────────────────────────────
// Users with last-login timestamp from audit_events
router.get('/users', asyncHandler(async (_req, res) => {
  const { rows } = await query(`
    SELECT
      u.id,
      u.email,
      u.role,
      u.created_at,
      u.updated_at,
      (SELECT MAX(ae.created_at)
         FROM audit_events ae
         WHERE ae.user_email = u.email AND ae.event_type = 'user_login') AS last_login_at,
      (SELECT COUNT(*)
         FROM audit_events ae
         WHERE ae.user_email = u.email AND ae.event_type = 'ad_generation_started')::int AS generation_count
    FROM users u
    ORDER BY u.created_at DESC
  `);
  res.json({ success: true, data: rows });
}));

// ── GET /api/admin/brands ─────────────────────────────────────
// Brands with asset, campaign and ad counts
router.get('/brands', asyncHandler(async (_req, res) => {
  const { rows } = await query(`
    SELECT
      b.id,
      b.name,
      b.slug,
      b.industry,
      b.is_active,
      b.created_at,
      b.updated_at,
      COUNT(DISTINCT ba.id)::int  AS asset_count,
      COUNT(DISTINCT c.id)::int   AS campaign_count,
      COUNT(DISTINCT ga.id)::int  AS ad_count
    FROM brands b
    LEFT JOIN brand_assets  ba ON ba.brand_id  = b.id
    LEFT JOIN campaigns      c  ON c.brand_id   = b.id
    LEFT JOIN generated_ads  ga ON ga.brand_id  = b.id
    GROUP BY b.id
    ORDER BY b.created_at DESC
  `);
  res.json({ success: true, data: rows });
}));

// ── GET /api/admin/campaigns ──────────────────────────────────
// Campaigns with brand name and ad count
router.get('/campaigns', asyncHandler(async (_req, res) => {
  const { rows } = await query(`
    SELECT
      c.id,
      c.name,
      c.mode,
      c.status,
      c.created_at,
      c.updated_at,
      b.name  AS brand_name,
      b.id    AS brand_id,
      COUNT(ga.id)::int AS ad_count
    FROM campaigns c
    LEFT JOIN brands        b  ON b.id  = c.brand_id
    LEFT JOIN generated_ads ga ON ga.campaign_id = c.id
    GROUP BY c.id, b.id
    ORDER BY c.created_at DESC
  `);
  res.json({ success: true, data: rows });
}));

// ── GET /api/admin/generations ────────────────────────────────
// Generated ads — omits image_url (base64), returns has_image flag instead
router.get('/generations', asyncHandler(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit,  10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  const { rows } = await query(`
    SELECT
      ga.id,
      ga.headline,
      ga.primary_text,
      ga.cta,
      ga.platform,
      ga.ad_format,
      ga.ai_model,
      ga.status,
      ga.quality_score,
      ga.created_at,
      ga.updated_at,
      ga.brand_id,
      ga.campaign_id,
      b.name  AS brand_name,
      c.name  AS campaign_name,
      (ga.image_url IS NOT NULL AND ga.image_url <> '') AS has_image
    FROM generated_ads ga
    LEFT JOIN brands    b ON b.id = ga.brand_id
    LEFT JOIN campaigns c ON c.id = ga.campaign_id
    ORDER BY ga.created_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);

  const { rows: countRows } = await query('SELECT COUNT(*) FROM generated_ads');

  res.json({
    success: true,
    data: rows,
    total: parseInt(countRows[0].count, 10),
  });
}));

// ── GET /api/admin/audit-events ───────────────────────────────
// Filterable audit log — delegates to auditService
router.get('/audit-events', asyncHandler(async (req, res) => {
  const {
    event_type,
    user_email,
    brand_id,
    campaign_id,
    from,
    to,
    search,
    limit,
    offset,
  } = req.query;

  const result = await getAuditEvents({
    event_type,
    user_email,
    brand_id,
    campaign_id,
    from,
    to,
    search,
    limit:  limit  ? parseInt(limit,  10) : 100,
    offset: offset ? parseInt(offset, 10) : 0,
  });

  res.json({ success: true, data: result.events, total: result.total });
}));

// ── GET /api/admin/system ─────────────────────────────────────
// Environment key presence booleans, node version, uptime, NODE_ENV
router.get('/system', asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: {
      env: {
        NODE_ENV:   process.env.NODE_ENV || 'development',
        openai:     !!process.env.OPENAI_API_KEY,
        anthropic:  !!process.env.ANTHROPIC_API_KEY,
        gemini:     !!process.env.GEMINI_API_KEY,
        session_secret_set: !!(process.env.SESSION_SECRET),
        database_url_set:   !!(process.env.DATABASE_URL || process.env.POSTGRES_URL),
        admin_emails_set:   !!(process.env.ADMIN_EMAILS),
      },
      node_version: process.version,
      uptime_seconds: Math.floor(process.uptime()),
    },
  });
}));

module.exports = router;
