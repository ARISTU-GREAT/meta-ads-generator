const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const { query } = require('../db');
const { asyncHandler, AppError } = require('../utils/errors');
const { ADMIN_EMAILS, isAdminEmail } = require('../middleware/auth');
const { logEvent } = require('../services/auditService');

const BCRYPT_ROUNDS = 12;

// ── Helpers ───────────────────────────────────────────────────

// Returns all registered admin rows
async function getRegisteredAdmins() {
  const { rows } = await query(
    'SELECT id, email, role, created_at FROM users WHERE role = $1',
    ['admin']
  );
  return rows;
}

// hasAdmin:
//   When ADMIN_EMAILS is configured → true only when ALL listed emails have registered
//     (keeps signup tab visible for any unregistered admin)
//   When ADMIN_EMAILS is empty (no config) → true when any admin row exists in DB
//     (preserves original single-admin behaviour for unconfigured deploys)
async function hasAdmin() {
  const registered = await getRegisteredAdmins();
  if (ADMIN_EMAILS.length === 0) {
    return registered.length > 0;
  }
  const registeredEmails = registered.map(r => r.email.toLowerCase());
  return ADMIN_EMAILS.every(e => registeredEmails.includes(e));
}

function sessionFor(req, user) {
  req.session.user_id = user.id;
  req.session.email   = user.email;
  req.session.role    = user.role;
}

// ── GET /api/auth/status ─────────────────────────────────────
// Returns whether ALL admin accounts exist so the frontend knows
// which form to show. Signup tab stays visible until every
// ADMIN_EMAILS address has registered.
router.get('/status', asyncHandler(async (_req, res) => {
  res.json({ hasAdmin: await hasAdmin() });
}));

// ── POST /api/auth/signup ────────────────────────────────────
// Allowed only when:
//   (a) ADMIN_EMAILS is configured → email must be in the list AND not yet registered
//   (b) ADMIN_EMAILS is empty      → no admin exists yet (original behaviour)
router.post('/signup', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new AppError('Email and password are required', 400);
  if (password.length < 8)  throw new AppError('Password must be at least 8 characters', 400);

  const normalizedEmail = email.toLowerCase().trim();

  if (ADMIN_EMAILS.length > 0) {
    // Strict allowlist: only emails in ADMIN_EMAILS may register
    if (!isAdminEmail(normalizedEmail)) {
      throw new AppError('This email is not authorised to create an admin account.', 403);
    }
    // Check this specific email hasn't already registered
    const { rows: existing } = await query(
      'SELECT id FROM users WHERE email = $1',
      [normalizedEmail]
    );
    if (existing.length) throw new AppError('An account already exists for this email.', 409);
  } else {
    // No allowlist configured — fall back to original single-admin gate
    const admins = await getRegisteredAdmins();
    if (admins.length) throw new AppError('Admin account already exists.', 409);
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, $2, 'admin') RETURNING id, email, role, created_at`,
    [normalizedEmail, hash]
  );
  const user = rows[0];

  sessionFor(req, user);
  req.session.save(err => {
    if (err) return res.status(500).json({ success: false, error: 'Session save failed' });
    logEvent(req, { event_type: 'user_signup', message: 'Admin account created' }).catch(() => {});
    res.status(201).json({ success: true, email: user.email, role: user.role });
  });
}));

// ── POST /api/auth/login ─────────────────────────────────────
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new AppError('Email and password are required', 400);

  const { rows } = await query(
    'SELECT * FROM users WHERE email = $1',
    [email.toLowerCase().trim()]
  );
  const user = rows[0];

  // Always run bcrypt even on miss to prevent timing attacks
  const hash    = user?.password_hash || '$2b$12$invalidhashpadding00000000000000000000000000000000000';
  const matches = await bcrypt.compare(password, hash);
  if (!user || !matches) throw new AppError('Invalid credentials', 401);

  sessionFor(req, user);
  req.session.save(err => {
    if (err) return res.status(500).json({ success: false, error: 'Session save failed' });
    console.log('[auth/login] session saved | sid:', req.session.id, '| user_id:', user.id);
    logEvent(req, { event_type: 'user_login', message: 'User logged in' }).catch(() => {});
    res.json({ success: true, email: user.email, role: user.role });
  });
}));

// ── POST /api/auth/logout ────────────────────────────────────
router.post('/logout', (req, res) => {
  logEvent(req, { event_type: 'user_logout', message: 'User logged out' }).catch(() => {});
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// ── GET /api/auth/me ─────────────────────────────────────────
router.get('/me', asyncHandler(async (req, res) => {
  console.log('[auth/me] session id:', req.session?.id ? 'present' : 'absent',
              '| user_id:', req.session?.user_id ? 'present' : 'absent',
              '| role:', req.session?.role || 'none');
  if (!req.session?.user_id) {
    return res.json({ authenticated: false });
  }
  const { rows } = await query(
    'SELECT id, email, role, created_at FROM users WHERE id = $1',
    [req.session.user_id]
  );
  if (!rows[0]) {
    req.session.destroy(() => {});
    return res.json({ authenticated: false });
  }
  const user = rows[0];
  // isAdmin flag: DB role OR email in ADMIN_EMAILS list
  const isAdmin = user.role === 'admin' || isAdminEmail(user.email);
  res.json({ authenticated: true, email: user.email, role: user.role, isAdmin });
}));

module.exports = router;
