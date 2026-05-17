/**
 * ensureMemoryTables
 *
 * Creates creative_memories and angle_library tables if they don't already
 * exist. Called on server startup so the app never crashes when the DB was
 * provisioned before these tables were added to schema.sql.
 */

const { pool } = require('../db');

const DDL = `
CREATE TABLE IF NOT EXISTS creative_memories (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id         UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  campaign_id      UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  source_type      TEXT NOT NULL DEFAULT 'manual_note',
  title            TEXT,
  image_url        TEXT,
  summary          TEXT,
  angle            TEXT,
  hook             TEXT,
  format           TEXT,
  persona          TEXT,
  visual_style     TEXT,
  copy_style       TEXT,
  performance_note TEXT,
  metadata         JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS angle_library (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id          UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  description       TEXT,
  persona           TEXT,
  pain_point        TEXT,
  emotional_trigger TEXT,
  hook_examples     JSONB DEFAULT '[]',
  offer_strategy    TEXT,
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_creative_memories_brand_id    ON creative_memories(brand_id);
CREATE INDEX IF NOT EXISTS idx_creative_memories_source_type ON creative_memories(source_type);
CREATE INDEX IF NOT EXISTS idx_angle_library_brand_id        ON angle_library(brand_id);
CREATE INDEX IF NOT EXISTS idx_angle_library_status          ON angle_library(status);
`;

async function ensureMemoryTables() {
  const client = await pool.connect();
  try {
    await client.query(DDL);
    console.log('[ensureMemoryTables] creative_memories and angle_library ready.');
  } catch (err) {
    // Non-fatal: log but don't crash startup
    console.error('[ensureMemoryTables] Migration failed (brand memory features will be degraded):', err.message);
  } finally {
    client.release();
  }
}

module.exports = { ensureMemoryTables };
