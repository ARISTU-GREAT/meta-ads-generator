const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const { query } = require('../db');
const { asyncHandler, AppError } = require('../utils/errors');

const BCRYPT_ROUNDS = 12;

// ── Helpers ───────────────────────────────────────────────────

async function getAdmin() {
  const { rows } = await query('SELECT * FROM users WHERE role = $1 LIMIT 1', ['admin']);
  return rows[0] || null;
}

function sessionFor(req, user) {
  req.session.user_id = user.id;
  req.session.email   = user.email;
  req.session.role    = user.role;
}

// ── GET /api/auth/status ─────────────────────────────────────
// Returns whether the admin account exists so the frontend knows
// which form to show on first load.
router.get('/status', asyncHandler(async (_req, res) => {
  const admin = await getAdmin();
  res.json({ hasAdmin: !!admin });
}));

// ── POST /api/auth/signup ────────────────────────────────────
// Only allowed when no admin exists yet (enforced server-side).
router.post('/signup', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new AppError('Email and password are required', 400);
  if (password.length < 8)  throw new AppError('Password must be at least 8 characters', 400);

  const existing = await getAdmin();
  if (existing) throw new AppError('Admin account already exists.', 409);

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const { rows } = await query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, $2, 'admin') RETURNING id, email, role, created_at`,
    [email.toLowerCase().trim(), hash]
  );
  const user = rows[0];

  sessionFor(req, user);
  req.session.save(err => {
    if (err) return res.status(500).json({ success: false, error: 'Session save failed' });
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
    res.json({ success: true, email: user.email, role: user.role });
  });
}));

// ── POST /api/auth/logout ────────────────────────────────────
router.post('/logout', (req, res) => {
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
  res.json({ authenticated: true, email: rows[0].email, role: rows[0].role });
}));

module.exports = router;
