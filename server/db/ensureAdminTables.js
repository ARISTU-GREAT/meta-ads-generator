const { pool } = require('../db');

const DDL = `
CREATE TABLE IF NOT EXISTS audit_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  user_email   TEXT,
  event_type   TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    UUID,
  brand_id     UUID REFERENCES brands(id) ON DELETE SET NULL,
  campaign_id  UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  message      TEXT,
  metadata     JSONB DEFAULT '{}',
  ip_address   TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at  ON audit_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_event_type  ON audit_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_events_user_email  ON audit_events(user_email);
CREATE INDEX IF NOT EXISTS idx_audit_events_brand_id    ON audit_events(brand_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_campaign_id ON audit_events(campaign_id);

-- Case-insensitive unique index on users.email
-- Prevents duplicate accounts that differ only in case.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

-- Ensure campaign_id column exists on generated_ads (added after initial schema)
ALTER TABLE generated_ads ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_generated_ads_campaign_id ON generated_ads(campaign_id);

-- Admin invites — allows admins to pre-authorise non-ADMIN_EMAILS signups
CREATE TABLE IF NOT EXISTS admin_invites (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email       TEXT NOT NULL,
  token       TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL DEFAULT 'admin',
  created_by  TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_invites_email_idx  ON admin_invites (lower(email));
CREATE INDEX IF NOT EXISTS admin_invites_token_idx  ON admin_invites (token);
CREATE INDEX IF NOT EXISTS admin_invites_status_idx ON admin_invites (status);
`;

async function ensureAdminTables() {
  const client = await pool.connect();
  try {
    await client.query(DDL);
    console.log('[ensureAdminTables] admin tables ready.');
  } catch (err) {
    console.error('[ensureAdminTables] Migration failed (admin features may be degraded):', err.message);
  } finally {
    client.release();
  }
}

module.exports = { ensureAdminTables };
