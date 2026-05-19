const express = require('express');
const bcrypt  = require('bcryptjs');
const crypto  = require('crypto');
const router  = express.Router();
const { query } = require('../db');
const { asyncHandler, AppError } = require('../utils/errors');
const { ADMIN_EMAILS, isAdminEmail } = require('../middleware/auth');
const { logEvent } = require('../services/auditService');

const BCRYPT_ROUNDS = 12;

// ── Helpers ───────────────────────────────────────────────────

// Lookup user by email, case-insensitive
async function findUserByEmail(email) {
  const { rows } = await query(
    'SELECT id, email, role, password_hash, created_at FROM users WHERE lower(email) = $1',
    [email.trim().toLowerCase()]
  );
  return rows[0] || null;
}

async function hasAdmin() {
  const { rows } = await query('SELECT COUNT(*) FROM users');
  return parseInt(rows[0].count, 10) > 0;
}

function sessionFor(req, user) {
  req.session.user_id = user.id;
  req.session.email   = user.email;
  req.session.role    = user.role;
}

// ── GET /api/auth/status ─────────────────────────────────────
router.get('/status', asyncHandler(async (_req, res) => {
  res.json({ hasAdmin: await hasAdmin() });
}));

// ── POST /api/auth/signup ────────────────────────────────────
// Allowed when email is in ADMIN_EMAILS, OR a valid pending invite token
// is provided. Never says "already registered" unless the users table
// actually has a row for that email.
router.post('/signup', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new AppError('Email and password are required', 400);
  if (password.length < 8)  throw new AppError('Password must be at least 8 characters', 400);

  const normalizedEmail = email.trim().toLowerCase();

  logEvent(req, { event_type: 'signup_attempt', message: `Signup attempt: ${normalizedEmail}` }).catch(() => {});

  // Authoritative check: is there a user row for this email?
  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    logEvent(req, { event_type: 'signup_blocked_existing_user', message: `Blocked: user row exists for ${normalizedEmail}` }).catch(() => {});
    throw new AppError('Account already exists. Please sign in.', 409);
  }

  // Determine role: admin if in ADMIN_EMAILS, otherwise regular user (via invite)
  let role = 'admin';

  if (ADMIN_EMAILS.length > 0 && !isAdminEmail(normalizedEmail)) {
    // Not on the env allowlist — check for a valid pending invite
    const invite = await findPendingInvite(normalizedEmail);
    if (!invite) {
      logEvent(req, { event_type: 'signup_blocked_not_authorized', message: `Blocked: not in ADMIN_EMAILS and no invite for ${normalizedEmail}` }).catch(() => {});
      throw new AppError('This email is not authorized to create an account.', 403);
    }
    if (new Date(invite.expires_at) < new Date()) {
      logEvent(req, { event_type: 'signup_blocked_invite_expired', message: `Blocked: invite expired for ${normalizedEmail}` }).catch(() => {});
      throw new AppError('Your invite has expired. Ask an admin to resend it.', 403);
    }
    role = invite.role || 'admin';
  }

  // Create the user
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  let newUser;
  try {
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)
       RETURNING id, email, role, created_at`,
      [normalizedEmail, hash, role]
    );
    newUser = rows[0];
  } catch (insertErr) {
    // UNIQUE violation — race condition, another request registered this email simultaneously
    if (insertErr.code === '23505') {
      throw new AppError('Account already exists. Please sign in.', 409);
    }
    throw insertErr;
  }

  // Mark invite accepted if one was used
  await markInviteAccepted(normalizedEmail).catch(() => {});

  sessionFor(req, newUser);
  req.session.save(async saveErr => {
    if (saveErr) {
      // Session save failed — roll back the inserted user to avoid ghost records
      console.error('[auth/signup] Session save failed after user creation. Rolling back user.', saveErr);
      await query('DELETE FROM users WHERE id = $1', [newUser.id]).catch(e =>
        console.error('[auth/signup] Rollback DELETE failed:', e.message)
      );
      logEvent(req, { event_type: 'signup_session_failed', message: `Session save failed for ${normalizedEmail}; user rolled back` }).catch(() => {});
      return res.status(500).json({ success: false, error: 'Account creation failed due to a session error. Please try again.' });
    }
    logEvent(req, { event_type: 'signup_success', message: `Account created: ${normalizedEmail} (${role})` }).catch(() => {});
    res.status(201).json({ success: true, email: newUser.email, role: newUser.role });
  });
}));

// ── POST /api/auth/accept-invite ─────────────────────────────
// Token-based signup. The admin shares the invite token; the user
// visits /signup?token=xxx, which calls this endpoint.
router.post('/accept-invite', asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) throw new AppError('Token and password are required', 400);
  if (password.length < 8)  throw new AppError('Password must be at least 8 characters', 400);

  // Validate token
  let invite;
  try {
    const { rows } = await query(
      `SELECT * FROM admin_invites WHERE token = $1 AND status = 'pending'`,
      [token]
    );
    invite = rows[0];
  } catch {
    throw new AppError('Invite system not available.', 503);
  }

  if (!invite) throw new AppError('Invalid or already used invite link.', 404);
  if (new Date(invite.expires_at) < new Date()) throw new AppError('Invite has expired. Ask an admin to resend it.', 410);

  const normalizedEmail = invite.email.trim().toLowerCase();

  logEvent(req, { event_type: 'invite_accept_attempt', message: `Invite accept attempt: ${normalizedEmail}` }).catch(() => {});

  // User must not already exist
  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    throw new AppError('Account already exists. Please sign in.', 409);
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  let newUser;
  try {
    const { rows } = await query(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)
       RETURNING id, email, role, created_at`,
      [normalizedEmail, hash, invite.role || 'admin']
    );
    newUser = rows[0];
  } catch (insertErr) {
    if (insertErr.code === '23505') {
      throw new AppError('Account already exists. Please sign in.', 409);
    }
    logEvent(req, { event_type: 'invite_accept_failed', message: `Insert failed for ${normalizedEmail}: ${insertErr.message}` }).catch(() => {});
    throw insertErr;
  }

  // Mark invite accepted
  await query(
    `UPDATE admin_invites SET status = 'accepted', accepted_at = NOW() WHERE id = $1`,
    [invite.id]
  ).catch(e => console.warn('[auth/accept-invite] Failed to mark invite accepted:', e.message));

  sessionFor(req, newUser);
  req.session.save(async saveErr => {
    if (saveErr) {
      console.error('[auth/accept-invite] Session save failed. Rolling back user.', saveErr);
      await query('DELETE FROM users WHERE id = $1', [newUser.id]).catch(() => {});
      logEvent(req, { event_type: 'invite_accept_failed', message: `Session failed for ${normalizedEmail}; rolled back` }).catch(() => {});
      return res.status(500).json({ success: false, error: 'Account creation failed due to a session error. Please try again.' });
    }
    logEvent(req, { event_type: 'invite_accept_success', message: `Invite accepted: ${normalizedEmail}` }).catch(() => {});
    res.status(201).json({ success: true, email: newUser.email, role: newUser.role });
  });
}));

// ── POST /api/auth/login ─────────────────────────────────────
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new AppError('Email and password are required', 400);

  const user = await findUserByEmail(email);

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
  const isAdmin = user.role === 'admin' || isAdminEmail(user.email);
  res.json({ authenticated: true, email: user.email, role: user.role, isAdmin });
}));

// ── Internal helpers ──────────────────────────────────────────

async function findPendingInvite(normalizedEmail) {
  try {
    const { rows } = await query(
      `SELECT * FROM admin_invites WHERE lower(email) = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
      [normalizedEmail]
    );
    return rows[0] || null;
  } catch {
    return null; // table may not exist yet
  }
}

async function markInviteAccepted(normalizedEmail) {
  await query(
    `UPDATE admin_invites SET status = 'accepted', accepted_at = NOW()
     WHERE lower(email) = $1 AND status = 'pending'`,
    [normalizedEmail]
  );
}

module.exports = router;
