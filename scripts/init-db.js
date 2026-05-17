require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { pool } = require('../server/db');

async function main() {
  const schemaPath = path.join(__dirname, '../server/db/schema.sql');
  const schema     = fs.readFileSync(schemaPath, 'utf-8');

  console.log('[init-db] Connecting to PostgreSQL…');
  const client = await pool.connect();
  try {
    console.log('[init-db] Running schema…');
    await client.query(schema);
    console.log('[init-db] Schema applied. Database is ready.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[init-db] Failed:', err.message);
  process.exit(1);
});
