const requestLogger = (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const line = `[${new Date().toISOString()}] ${req.method} ${req.path} ${res.statusCode} ${ms}ms`;
    if (res.statusCode >= 500) console.error(line);
    else if (res.statusCode >= 400) console.warn(line);
    else console.log(line);
  });
  next();
};

const log = (level, message, data = null) => {
  const entry = { timestamp: new Date().toISOString(), level, message, ...(data && { data }) };
  level === 'error' ? console.error(JSON.stringify(entry)) : console.log(JSON.stringify(entry));
};

module.exports = {
  requestLogger,
  info:  (msg, data) => log('info',  msg, data),
  warn:  (msg, data) => log('warn',  msg, data),
  error: (msg, data) => log('error', msg, data),
};
