const path = require('path');
const fs   = require('fs');

const ON_VERCEL = process.env.VERCEL === '1';

const UPLOAD_BASE   = ON_VERCEL
  ? '/tmp/uploads'
  : path.join(__dirname, '..', 'uploads');

const TEMP_DIR      = path.join(UPLOAD_BASE, 'temp');
const GENERATED_DIR = path.join(UPLOAD_BASE, 'generated');

// Ensure critical directories exist at require-time (safe on both runtimes)
[UPLOAD_BASE, TEMP_DIR, GENERATED_DIR].forEach(dir => {
  fs.mkdirSync(dir, { recursive: true });
});

module.exports = { ON_VERCEL, UPLOAD_BASE, TEMP_DIR, GENERATED_DIR };
