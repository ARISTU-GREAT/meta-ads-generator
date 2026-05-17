require('dotenv').config();
const app = require('./server/app');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Meta Ads Generator] Listening on http://0.0.0.0:${PORT}`);
  console.log(`[Meta Ads Generator] Env: ${process.env.NODE_ENV || 'development'}`);
});

process.on('SIGTERM', () => {
  server.close(() => {
    console.log('[Meta Ads Generator] Server closed gracefully.');
    process.exit(0);
  });
});
