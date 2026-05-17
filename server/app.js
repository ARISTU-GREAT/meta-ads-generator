const express      = require('express');
const path         = require('path');
const session      = require('express-session');
const pgSession    = require('connect-pg-simple')(session);
const { pool }     = require('./db');

const brandsRouter     = require('./routes/brands');
const uploadRouter     = require('./routes/upload');
const adsRouter        = require('./routes/ads');
const layoutsRouter    = require('./routes/layouts');
const templatesRouter  = require('./routes/templates');
const jobsRouter       = require('./routes/jobs');
const generateRouter   = require('./routes/generate');
const campaignsRouter  = require('./routes/campaigns');
const conceptsRouter   = require('./routes/concepts');
const authRouter       = require('./routes/auth');
const aiRouter         = require('./routes/ai');
const { requireAuth }  = require('./middleware/auth');
const { errorHandler, notFound } = require('./utils/errors');
const { UPLOAD_BASE }  = require('./utils/paths');
const logger = require('./utils/logger');

const app = express();

// Trust Vercel/reverse-proxy so secure cookies work behind HTTPS termination
app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(logger.requestLogger);

// Session — PostgreSQL-backed so sessions survive restarts and Vercel cold starts
const isProd = process.env.NODE_ENV === 'production';
app.use(session({
  store: new pgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: false, // table created by schema.sql
  }),
  secret:            process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   isProd,
    sameSite: isProd ? 'none' : 'lax',
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// Favicon — prevent 404 or SPA fallback for browser automatic requests
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// Public image endpoint — serves ad image bytes without session auth so
// the Figma plugin (which cannot send cookies) can fetch the image.
// Security: ad UUID is 128-bit random; guessing is not practical.
app.get('/api/ads/:id/image', (req, res, next) => {
  const { pool: dbPool } = require('./db');
  dbPool.query('SELECT image_url FROM generated_ads WHERE id = $1', [req.params.id])
    .then(({ rows }) => {
      if (!rows.length || !rows[0].image_url) return res.status(404).json({ error: 'Image not found' });
      const dataUrl = rows[0].image_url;
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
      if (!match) return res.status(500).json({ error: 'Unsupported image format' });
      const mimeType = match[1];
      const buf = Buffer.from(match[2], 'base64');
      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Length', buf.length);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('Access-Control-Allow-Origin', '*');  // required for Figma plugin fetch
      res.send(buf);
    })
    .catch(next);
});

// Serve static frontend (public assets are always accessible)
app.use(express.static(path.join(__dirname, '../public')));

// Serve uploaded files from the runtime-appropriate directory
app.use('/uploads', express.static(UPLOAD_BASE));

// Auth routes (public — no requireAuth)
app.use('/api/auth', authRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// AI provider availability — public, no auth required
// Lets the frontend know which providers are configured before the user logs in
app.get('/api/health/ai', (req, res) => {
  res.json({
    openai:    !!process.env.OPENAI_API_KEY,
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    gemini:    !!process.env.GEMINI_API_KEY,
  });
});

// All remaining API routes require authentication
app.use('/api', requireAuth);

app.use('/api/brands',    brandsRouter);
app.use('/api/upload',    uploadRouter);
app.use('/api/ads',       adsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/jobs',      jobsRouter);
app.use('/api/generate',  generateRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/concepts',  conceptsRouter);
app.use('/api/ai',        aiRouter);
app.use('/api/ads/:id/layout', layoutsRouter);

// SPA fallback — only for non-API, non-asset routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
