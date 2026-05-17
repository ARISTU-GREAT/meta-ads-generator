class AppError extends Error {
  constructor(message, statusCode = 500, data = null) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.data = data;
    Error.captureStackTrace(this, this.constructor);
  }
}

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const notFound = (req, res, next) =>
  next(new AppError(`${req.method} ${req.path} not found`, 404));

const errorHandler = (err, req, res, _next) => {
  const statusCode = err.statusCode || 500;

  if (process.env.NODE_ENV !== 'production') {
    console.error(`[ERROR] ${err.message}`, err.stack);
  }

  res.status(statusCode).json({
    success: false,
    error: err.message,
    ...(err.data || {}),
    ...(process.env.NODE_ENV !== 'production' && !err.isOperational && { stack: err.stack }),
  });
};

module.exports = { AppError, asyncHandler, notFound, errorHandler };
