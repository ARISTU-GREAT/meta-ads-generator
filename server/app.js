const express  = require('express');
const path     = require('path');
const session  = require('express-session');

const brandsRouter     = require('./routes/brands');
const uploadRouter     = require('./routes/upload');
const adsRouter        = require('./routes/ads');
const templatesRouter  = require('./routes/templates');
const jobsRouter       = require('./routes/jobs');
const generateRouter   = require('./routes/generate');
const campaignsRouter  = require('./routes/campaigns');
const conceptsRouter   = require('./routes/concepts');
const authRouter       = require('./routes/auth');
const { requireAuth }  = require('./middleware/auth');
const { errorHandler, notFound } = require('./utils/errors');
const { UPLOAD_BASE }  = require('./utils/paths');
const logger = require('./utils/logger');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(logger.requestLogger);

// Session
const isProd = process.env.NODE_ENV === 'production';
app.use(session({
  secret:            process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   isProd,
    sameSite: 'lax',
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));

// Favicon — prevent 404 or SPA fallback for browser automatic requests
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// Serve static frontend (public assets are always accessible)
app.use(express.static(path.join(__dirname, '../public')));

// Serve uploaded files from the runtime-appropriate directory
app.use('/uploads', express.static(UPLOAD_BASE));

// Auth routes (public — no requireAuth)
app.use('/api/auth', authRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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

// SPA fallback — only for non-API, non-asset routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
