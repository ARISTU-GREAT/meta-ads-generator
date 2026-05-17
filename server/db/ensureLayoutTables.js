const { pool } = require('../db');

const DDL = `
  CREATE TABLE IF NOT EXISTS creative_layouts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ad_id            UUID NOT NULL REFERENCES generated_ads(id) ON DELETE CASCADE,
    layout_json      JSONB NOT NULL,
    figma_exportable BOOLEAN NOT NULL DEFAULT true,
    version          TEXT NOT NULL DEFAULT '1.0',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS creative_layouts_ad_id_idx ON creative_layouts(ad_id);
`;

async function ensureLayoutTables() {
  const client = await pool.connect();
  try {
    await client.query(DDL);
    console.log('[ensureLayoutTables] ready.');
  } catch (err) {
    console.error('[ensureLayoutTables] Migration failed:', err.message);
  } finally {
    client.release();
  }
}

module.exports = { ensureLayoutTables };
