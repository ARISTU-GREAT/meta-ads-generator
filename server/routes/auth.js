const express  = require('express');
const bcrypt   = require('bcryptjs');
const router   = express.Router();
const { asyncHandler, AppError } = require('../utils/errors');

// Compare submitted password against ADMIN_PASSWORD env var.
// We support both plain-text (fast MVP) and bcrypt hashes transparently:
// if ADMIN_PASSWORD starts with "$2" it is treated as a bcrypt hash,
// otherwise a constant-time string comparison is used.
async function verifyPassword(submitted) {
  const stored = process.env.ADMIN_PASSWORD || '';
  if (!stored) return false;
  if (stored.startsWith('$2')) {
    return bcrypt.compare(submitted, stored);
  }
  // Constant-time compare to resist timing attacks even for plain-text passwords
  const a = Buffer.from(submitted);
  const b = Buffer.from(stored);
  if (a.length !== b.length) {
    // Still do a dummy compare so timing is consistent
    bcrypt.compareSync(submitted, '$2b$10$invalidhashpadding000000000000000000000000000000000000000');
    return false;
  }
  return require('crypto').timingSafeEqual(a, b);
}

// POST /api/auth/login
router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();

  if (!email || !password) throw new AppError('Email and password are required', 400);
  if (email.toLowerCase().trim() !== adminEmail) throw new AppError('Invalid credentials', 401);

  const ok = await verifyPassword(password);
  if (!ok) throw new AppError('Invalid credentials', 401);

  req.session.authenticated = true;
  req.session.email = adminEmail;
  res.json({ success: true, email: adminEmail });
}));

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  if (req.session?.authenticated) {
    return res.json({ authenticated: true, email: req.session.email });
  }
  res.json({ authenticated: false });
});

module.exports = router;
