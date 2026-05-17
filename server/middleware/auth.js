// Routes that bypass authentication
const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/auth/signup',
  '/api/auth/status',
  '/api/health',
];

function requireAuth(req, res, next) {
  if (PUBLIC_PATHS.includes(req.path)) return next();
  if (req.session?.user_id) return next();
  res.status(401).json({ success: false, error: 'Unauthorized' });
}

module.exports = { requireAuth };
