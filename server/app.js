const express = require('express');
const path = require('path');

const brandsRouter     = require('./routes/brands');
const uploadRouter     = require('./routes/upload');
const adsRouter        = require('./routes/ads');
const templatesRouter  = require('./routes/templates');
const jobsRouter       = require('./routes/jobs');
const generateRouter   = require('./routes/generate');
const campaignsRouter  = require('./routes/campaigns');
const conceptsRouter   = require('./routes/concepts');
const { errorHandler, notFound } = require('./utils/errors');
const { UPLOAD_BASE }  = require('./utils/paths');
const logger = require('./utils/logger');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(logger.requestLogger);

// Favicon — prevent 404 or SPA fallback for browser automatic requests
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// Serve static frontend
app.use(express.static(path.join(__dirname, '../public')));

// Serve uploaded files from the runtime-appropriate directory
app.use('/uploads', express.static(UPLOAD_BASE));

// API routes
app.use('/api/brands',    brandsRouter);
app.use('/api/upload',    uploadRouter);
app.use('/api/ads',       adsRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/jobs',      jobsRouter);
app.use('/api/generate',  generateRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/concepts',  conceptsRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// SPA fallback — only for non-API, non-asset routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/')) return next();
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
