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

// V2 columns — added after initial creation; idempotent
const DDL_V2 = `
  ALTER TABLE creative_layouts ADD COLUMN IF NOT EXISTS editable_json        JSONB;
  ALTER TABLE creative_layouts ADD COLUMN IF NOT EXISTS editable_analyzed_at TIMESTAMPTZ;
`;

// V3 columns — Claude Design Blueprint
const DDL_V3 = `
  ALTER TABLE creative_layouts ADD COLUMN IF NOT EXISTS blueprint_json        JSONB;
  ALTER TABLE creative_layouts ADD COLUMN IF NOT EXISTS blueprint_analyzed_at TIMESTAMPTZ;
`;

// V4 columns — Layout-First Editable Design mode
const DDL_V4 = `
  ALTER TABLE creative_layouts ADD COLUMN IF NOT EXISTS source_mode          TEXT NOT NULL DEFAULT 'image_first';
  ALTER TABLE creative_layouts ADD COLUMN IF NOT EXISTS status               TEXT NOT NULL DEFAULT 'draft';
  ALTER TABLE creative_layouts ADD COLUMN IF NOT EXISTS rendered_preview_url TEXT;
`;

async function ensureLayoutTables() {
  const client = await pool.connect();
  try {
    await client.query(DDL);
    await client.query(DDL_V2);
    await client.query(DDL_V3);
    await client.query(DDL_V4);
    console.log('[ensureLayoutTables] ready.');
  } catch (err) {
    console.error('[ensureLayoutTables] Migration failed:', err.message);
  } finally {
    client.release();
  }
}

module.exports = { ensureLayoutTables };
