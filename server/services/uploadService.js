const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const { query }      = require('../db');
const { AppError }   = require('../utils/errors');
const { UPLOAD_BASE } = require('../utils/paths');

const UPLOAD_DIR    = UPLOAD_BASE;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, req.body.brand_id || 'general');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const ext    = path.extname(file.originalname).toLowerCase();
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, unique);
  },
});

const fileFilter = (_req, file, cb) => {
  if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
  else cb(new AppError('File type not allowed. Use JPG, PNG, or WebP.', 400), false);
};

const upload = multer({ storage, fileFilter, limits: { fileSize: MAX_FILE_SIZE } });

const middleware         = () => upload.single('file');
const multipleMiddleware = () => upload.array('files', 20);

const processUploads = async (files, brandId, assetType) => {
  const list = Array.isArray(files) ? files : [files];
  const root = path.join(__dirname, '../../');

  return Promise.all(list.map(async (file) => {
    const relativePath = path.relative(root, file.path);
    const relToUploads = path.relative(UPLOAD_DIR, file.path).replace(/\\/g, '/');
    const url = `/uploads/${relToUploads}`;

    if (brandId) {
      const { rows } = await query(
        `INSERT INTO brand_assets (brand_id, asset_type, name, file_path, file_url, mime_type, file_size)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [brandId, assetType, file.originalname, relativePath, url, file.mimetype, file.size]
      );
      return rows[0];
    }

    return { name: file.originalname, file_path: relativePath, file_url: url, mime_type: file.mimetype, file_size: file.size };
  }));
};

const deleteAsset = async (assetId) => {
  const { rows } = await query('SELECT file_path FROM brand_assets WHERE id = $1', [assetId]);
  if (!rows.length) throw new AppError('Asset not found', 404);

  const fullPath = path.join(__dirname, '../../', rows[0].file_path);
  if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

  await query('DELETE FROM brand_assets WHERE id = $1', [assetId]);
};

module.exports = { middleware, multipleMiddleware, processUploads, deleteAsset };
