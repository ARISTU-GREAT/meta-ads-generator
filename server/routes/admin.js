const express = require('express');
const router  = express.Router();
const { query } = require('../db');
const { asyncHandler } = require('../utils/errors');
const { getAuditEvents } = require('../services/auditService');
const { isAdminEmail, ADMIN_EMAILS } = require('../middleware/auth');

// All routes are already protected by requireAdmin (mounted in app.js)

// ── Safe query helpers ────────────────────────────────────────
// Return a fallback instead of throwing when a table doesn't exist.

async function safeCount(tableName, whereClause = '', params = []) {
  const sql = whereClause
    ? `SELECT COUNT(*) FROM ${tableName} WHERE ${whereClause}`
    : `SELECT COUNT(*) FROM ${tableName}`;
  try {
    const { rows } = await query(sql, params);
    return parseInt(rows[0].count, 10);
  } catch (err) {
    console.warn(`[ADMIN] safeCount(${tableName}) failed:`, err.message);
    return 0;
  }
}

async function safeQuery(sql, params = [], fallback = []) {
  try {
    const { rows } = await query(sql, params);
    return rows;
  } catch (err) {
    console.warn('[ADMIN] safeQuery failed:', err.message, '| sql:', sql.slice(0, 80));
    return fallback;
  }
}

// ── GET /api/admin/overview ──────────────────────────────────
router.get('/overview', asyncHandler(async (_req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    users,
    brands,
    campaigns,
    generatedAds,
    brandAssets,
    todayGenerations,
    recentAudit,
  ] = await Promise.all([
    safeCount('users'),
    safeCount('brands', 'is_active = true'),
    safeCount('campaigns'),
    safeCount('generated_ads'),
    safeCount('brand_assets'),
    safeCount('generated_ads', 'created_at >= $1', [todayStart.toISOString()]),
    safeQuery(
      'SELECT id, user_email, event_type, entity_type, brand_id, campaign_id, message, created_at FROM audit_events ORDER BY created_at DESC LIMIT 20',
      [],
      []
    ),
  ]);

  res.json({
    success: true,
    data: {
      counts: {
        users,
        brands,
        campaigns,
        generated_ads:     generatedAds,
        brand_assets:      brandAssets,
        today_generations: todayGenerations,
      },
      recent_audit_events: recentAudit,
    },
  });
}));

// ── GET /api/admin/users ─────────────────────────────────────
router.get('/users', asyncHandler(async (_req, res) => {
  try {
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
  } catch (err) {
    console.error('[ADMIN_ROUTE_ERROR] /users', { message: err.message, stack: err.stack });
    // Fallback: basic user list without audit join
    const rows = await safeQuery('SELECT id, email, role, created_at, updated_at FROM users ORDER BY created_at DESC');
    res.json({
      success: true,
      data: rows.map(u => ({ ...u, last_login_at: null, generation_count: 0 })),
    });
  }
}));

// ── GET /api/admin/brands ─────────────────────────────────────
router.get('/brands', asyncHandler(async (_req, res) => {
  try {
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
  } catch (err) {
    console.error('[ADMIN_ROUTE_ERROR] /brands', { message: err.message, stack: err.stack });
    const rows = await safeQuery('SELECT id, name, slug, industry, is_active, created_at, updated_at FROM brands ORDER BY created_at DESC');
    res.json({
      success: true,
      data: rows.map(b => ({ ...b, asset_count: 0, campaign_count: 0, ad_count: 0 })),
    });
  }
}));

// ── GET /api/admin/campaigns ──────────────────────────────────
router.get('/campaigns', asyncHandler(async (_req, res) => {
  try {
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
  } catch (err) {
    console.error('[ADMIN_ROUTE_ERROR] /campaigns', { message: err.message, stack: err.stack });
    const rows = await safeQuery(`
      SELECT c.id, c.name, c.mode, c.status, c.created_at, c.updated_at, b.name AS brand_name, b.id AS brand_id
      FROM campaigns c LEFT JOIN brands b ON b.id = c.brand_id ORDER BY c.created_at DESC
    `);
    res.json({ success: true, data: rows.map(c => ({ ...c, ad_count: 0 })) });
  }
}));

// ── GET /api/admin/generations ────────────────────────────────
router.get('/generations', asyncHandler(async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit,  10) || 50, 200);
  const offset = parseInt(req.query.offset, 10) || 0;

  try {
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

    const total = await safeCount('generated_ads');
    res.json({ success: true, data: rows, total });
  } catch (err) {
    console.error('[ADMIN_ROUTE_ERROR] /generations', { message: err.message, stack: err.stack });
    // Fallback without campaign join (campaign_id column may not exist)
    const rows = await safeQuery(`
      SELECT id, headline, platform, ad_format, ai_model, status, quality_score, created_at, updated_at, brand_id,
             (image_url IS NOT NULL AND image_url <> '') AS has_image
      FROM generated_ads ORDER BY created_at DESC LIMIT $1 OFFSET $2
    `, [limit, offset], []);
    const total = await safeCount('generated_ads');
    res.json({
      success: true,
      data: rows.map(r => ({ ...r, campaign_id: null, brand_name: null, campaign_name: null })),
      total,
    });
  }
}));

// ── GET /api/admin/audit-events ───────────────────────────────
router.get('/audit-events', asyncHandler(async (req, res) => {
  const {
    event_type, user_email, brand_id, campaign_id,
    from, to, search, limit, offset,
  } = req.query;

  try {
    const result = await getAuditEvents({
      event_type, user_email, brand_id, campaign_id, from, to, search,
      limit:  limit  ? parseInt(limit,  10) : 100,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    res.json({ success: true, data: result.events, total: result.total });
  } catch (err) {
    console.error('[ADMIN_ROUTE_ERROR] /audit-events', { message: err.message, stack: err.stack });
    res.json({ success: true, data: [], total: 0 });
  }
}));

// ── GET /api/admin/system ─────────────────────────────────────
router.get('/system', asyncHandler(async (_req, res) => {
  res.json({
    success: true,
    data: {
      env: {
        NODE_ENV:           process.env.NODE_ENV || 'development',
        openai:             !!process.env.OPENAI_API_KEY,
        anthropic:          !!process.env.ANTHROPIC_API_KEY,
        gemini:             !!process.env.GEMINI_API_KEY,
        session_secret_set: !!(process.env.SESSION_SECRET),
        database_url_set:   !!(process.env.DATABASE_URL || process.env.POSTGRES_URL),
        admin_emails_set:   !!(process.env.ADMIN_EMAILS),
      },
      node_version:   process.version,
      uptime_seconds: Math.floor(process.uptime()),
    },
  });
}));

// ── GET /api/admin/debug-email ────────────────────────────────
// Diagnostic: look up a specific email in users and admin_invites.
router.get('/debug-email', asyncHandler(async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ success: false, error: 'email query param required' });

  const normalizedEmail = email.trim().toLowerCase();

  const [userRows, inviteRows] = await Promise.all([
    safeQuery(
      'SELECT id, email, role, created_at FROM users WHERE lower(email) = $1',
      [normalizedEmail],
      []
    ),
    safeQuery(
      `SELECT id, email, role, status, created_by, created_at, expires_at, accepted_at
       FROM admin_invites WHERE lower(email) = $1 ORDER BY created_at DESC LIMIT 5`,
      [normalizedEmail],
      []
    ),
  ]);

  res.json({
    success: true,
    data: {
      normalizedEmail,
      userFound:   userRows.length > 0,
      user:        userRows[0] || null,
      inviteFound: inviteRows.length > 0,
      invite:      inviteRows[0] || null,
      allInvites:  inviteRows,
    },
  });
}));

// ── GET /api/admin/invites ────────────────────────────────────
router.get('/invites', asyncHandler(async (_req, res) => {
  const rows = await safeQuery(
    `SELECT id, email, role, status, created_by, created_at, expires_at, accepted_at,
            token
     FROM admin_invites ORDER BY created_at DESC`,
    [],
    []
  );
  res.json({ success: true, data: rows });
}));

// ── POST /api/admin/invites ───────────────────────────────────
// Create an invite for an email. Returns the token (share manually).
router.post('/invites', asyncHandler(async (req, res) => {
  const { email, role = 'admin' } = req.body;
  if (!email) throw new Error('email is required');

  const normalizedEmail = email.trim().toLowerCase();
  const createdBy = req.session?.email || null;

  // Check user doesn't already exist
  const { rows: existingUser } = await query(
    'SELECT id FROM users WHERE lower(email) = $1',
    [normalizedEmail]
  );
  if (existingUser.length) {
    return res.status(409).json({ success: false, error: 'User already has an account.' });
  }

  // Revoke any existing pending invites for this email
  await query(
    `UPDATE admin_invites SET status = 'revoked' WHERE lower(email) = $1 AND status = 'pending'`,
    [normalizedEmail]
  ).catch(() => {});

  const token = crypto.randomBytes(32).toString('hex');
  const { rows } = await query(
    `INSERT INTO admin_invites (email, token, role, created_by, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days')
     RETURNING id, email, role, token, status, created_at, expires_at`,
    [normalizedEmail, token, role, createdBy]
  );

  logEvent(req, {
    event_type: 'invite_created',
    message: `Invite created for ${normalizedEmail} by ${createdBy}`,
  }).catch(() => {});

  res.status(201).json({ success: true, data: rows[0] });
}));

// ── DELETE /api/admin/invites/:id ────────────────────────────
router.delete('/invites/:id', asyncHandler(async (req, res) => {
  await query(
    `UPDATE admin_invites SET status = 'revoked' WHERE id = $1`,
    [req.params.id]
  );
  logEvent(req, { event_type: 'invite_revoked', message: `Invite ${req.params.id} revoked` }).catch(() => {});
  res.json({ success: true });
}));

// ── GET /api/admin/debug ──────────────────────────────────────
// Diagnostic endpoint: confirms auth, lists tables and row counts.
// Returns env flags only — no secret values.
router.get('/debug', asyncHandler(async (req, res) => {
  const tables = [
    'users', 'admin_invites', 'brands', 'brand_assets', 'campaigns',
    'generated_ads', 'audit_events', 'creative_memories',
    'creative_layouts', 'session',
  ];

  const tableChecks = {};
  for (const t of tables) {
    try {
      const { rows } = await query(`SELECT COUNT(*) FROM ${t}`);
      tableChecks[t] = { exists: true, count: parseInt(rows[0].count, 10) };
    } catch (err) {
      tableChecks[t] = { exists: false, error: err.message };
    }
  }

  res.json({
    success: true,
    data: {
      session_user: {
        email:   req.session?.email  || null,
        role:    req.session?.role   || null,
        user_id: req.session?.user_id ? '[present]' : null,
      },
      is_admin_email: isAdminEmail(req.session?.email || ''),
      admin_emails_count: ADMIN_EMAILS.length,
      tables: tableChecks,
      env: {
        NODE_ENV:           process.env.NODE_ENV || 'development',
        openai:             !!process.env.OPENAI_API_KEY,
        anthropic:          !!process.env.ANTHROPIC_API_KEY,
        gemini:             !!process.env.GEMINI_API_KEY,
        session_secret_set: !!(process.env.SESSION_SECRET),
        database_url_set:   !!(process.env.DATABASE_URL || process.env.POSTGRES_URL),
        admin_emails_set:   !!(process.env.ADMIN_EMAILS),
      },
    },
  });
}));

module.exports = router;
