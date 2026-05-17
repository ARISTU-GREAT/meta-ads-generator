const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { query }    = require('../db');
const { AppError } = require('./errors');

// Fetch a brand_asset row by ID, decode its base64 data URL, write to a temp file,
// and return { path, mime, cleanup } so callers can use it like a multer-uploaded file.
async function resolveAssetToFile(assetId) {
  const { rows } = await query(
    'SELECT id, file_url, mime_type, name FROM brand_assets WHERE id = $1',
    [assetId]
  );
  if (!rows.length) throw new AppError(`Asset ${assetId} not found`, 404);
  const asset = rows[0];

  const dataUrl = asset.file_url || '';
  const match   = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!match) throw new AppError(`Asset ${assetId} has no stored image data`, 500);

  const mime   = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const ext    = mime === 'image/png' ? '.png'
               : mime === 'image/webp' ? '.webp'
               : '.jpg';
  const tmpPath = path.join(
    os.tmpdir(),
    `asset-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`
  );
  fs.writeFileSync(tmpPath, buffer);

  return {
    path: tmpPath,
    mime,
    originalname: asset.name,
    cleanup() {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
    },
  };
}

// Resolve an image from either an uploaded multer file OR a saved asset ID.
// Throws 400 if neither is provided.
async function resolveImage(file, assetId, fieldLabel) {
  if (file) {
    return { path: file.path, mime: file.mimetype, cleanup() {} };
  }
  if (assetId) {
    return resolveAssetToFile(assetId);
  }
  throw new AppError(`${fieldLabel} is required — upload a file or choose a brand asset`, 400);
}

module.exports = { resolveAssetToFile, resolveImage };
