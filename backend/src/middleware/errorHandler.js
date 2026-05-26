import { logger } from '../utils/logger.js'

export function errorHandler(err, req, res, next) {
  logger.error(err.message, err.stack)

  const status = err.status || err.statusCode || 500
  const message = status < 500 ? err.message : 'Internal server error'

  res.status(status).json({ error: message })
}

export function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` })
}
