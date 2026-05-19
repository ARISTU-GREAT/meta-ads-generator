// Routes that bypass authentication
const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/auth/signup',
  '/api/auth/accept-invite',
  '/api/auth/status',
  '/api/health',
];

// Parse ADMIN_EMAILS from env — comma-separated, case-insensitive, trimmed.
// Falls back to empty array; auth.js handles the no-config case.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

function isAdminEmail(email) {
  if (!email) return false;
  return ADMIN_EMAILS.includes(email.trim().toLowerCase());
}

function requireAuth(req, res, next) {
  if (PUBLIC_PATHS.includes(req.path)) return next();
  if (req.session?.user_id) return next();
  res.status(401).json({ success: false, error: 'Unauthorized' });
}

function requireAdmin(req, res, next) {
  if (!req.session?.user_id) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  const sessionEmail = req.session?.email || '';
  if (req.session?.role === 'admin' || isAdminEmail(sessionEmail)) {
    return next();
  }
  res.status(403).json({ success: false, error: 'Forbidden' });
}

module.exports = { requireAuth, requireAdmin, isAdminEmail, ADMIN_EMAILS };
