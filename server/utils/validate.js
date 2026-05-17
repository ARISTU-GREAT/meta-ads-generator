const { AppError } = require('./errors');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUUID      = (str) => UUID_RE.test(str);
const requireFields = (body, fields) => {
  const missing = fields.filter((f) => body[f] == null || body[f] === '');
  if (missing.length) throw new AppError(`Missing required fields: ${missing.join(', ')}`, 400);
};
const validateUUID = (id, field = 'id') => {
  if (!isUUID(id)) throw new AppError(`Invalid ${field} format`, 400);
};
const validateEnum = (value, allowed, field) => {
  if (!allowed.includes(value))
    throw new AppError(`Invalid ${field}. Allowed: ${allowed.join(', ')}`, 400);
};

module.exports = { isUUID, requireFields, validateUUID, validateEnum };
