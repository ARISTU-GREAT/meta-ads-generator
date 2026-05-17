const multer  = require('multer');
const { query }    = require('../db');
const { AppError } = require('../utils/errors');

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// Memory storage — no filesystem writes, works on Vercel
const storage = multer.memoryStorage();

const fileFilter = (_req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
  else cb(new AppError('File type not allowed. Use JPG, PNG, or WebP.', 400), false);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE } });

const middleware         = () => upload.single('file');
const multipleMiddleware = () => upload.array('files', 20);

// Convert in-memory buffer to a base64 data URL for DB storage
function bufferToDataUrl(file) {
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

const processUploads = async (files, brandId, assetType) => {
  const list = Array.isArray(files) ? files : [files];

  return Promise.all(list.map(async (file) => {
    const fileUrl = bufferToDataUrl(file);

    if (brandId) {
      const { rows } = await query(
        `INSERT INTO brand_assets (brand_id, asset_type, name, file_path, file_url, mime_type, file_size)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [brandId, assetType || 'image', file.originalname, null, fileUrl, file.mimetype, file.size]
      );
      return rows[0];
    }

    return {
      name:      file.originalname,
      file_url:  fileUrl,
      mime_type: file.mimetype,
      file_size: file.size,
    };
  }));
};

const deleteAsset = async (assetId) => {
  const { rows } = await query('SELECT id FROM brand_assets WHERE id = $1', [assetId]);
  if (!rows.length) throw new AppError('Asset not found', 404);
  await query('DELETE FROM brand_assets WHERE id = $1', [assetId]);
};

module.exports = { middleware, multipleMiddleware, processUploads, deleteAsset };
