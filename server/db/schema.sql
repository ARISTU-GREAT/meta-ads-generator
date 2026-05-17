-- ============================================================
-- Meta Ads Generator — Database Schema
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ────────────────────────────────────────────────────────────
-- SESSIONS — connect-pg-simple persistent session store
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "session" (
  "sid"    VARCHAR NOT NULL COLLATE "default",
  "sess"   JSON    NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE
) WITH (OIDS=FALSE);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- ────────────────────────────────────────────────────────────
-- USERS — single-admin auth (expand to multi-user later)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- BRANDS — core multi-tenant entity
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brands (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             VARCHAR(255) NOT NULL,
  slug             VARCHAR(255) UNIQUE NOT NULL,
  description      TEXT,
  primary_color    VARCHAR(20),
  secondary_color  VARCHAR(20),
  logo_url         TEXT,
  website_url      TEXT,
  industry         VARCHAR(100),
  target_audience  TEXT,
  brand_voice      TEXT,
  offer_cta              TEXT,
  primary_font           VARCHAR(120),
  secondary_font         VARCHAR(120),
  headline_style         VARCHAR(120),
  typography_personality TEXT,
  metadata         JSONB    DEFAULT '{}',
  is_active        BOOLEAN  DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- BRAND_ASSETS — images, logos, fonts per brand
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brand_assets (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id    UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  asset_type  VARCHAR(50) NOT NULL, -- logo | image | video | font | color_palette
  name        VARCHAR(255) NOT NULL,
  file_path   TEXT,
  file_url    TEXT,
  mime_type   VARCHAR(100),
  file_size   INTEGER,
  width       INTEGER,
  height      INTEGER,
  tags        TEXT[]   DEFAULT '{}',
  metadata    JSONB    DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- BRAND_PERSONAS — target audience definitions
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brand_personas (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id     UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name         VARCHAR(255) NOT NULL,
  age_range    VARCHAR(50),
  gender       VARCHAR(50),
  interests    TEXT[]  DEFAULT '{}',
  pain_points  TEXT[]  DEFAULT '{}',
  goals        TEXT[]  DEFAULT '{}',
  income_range VARCHAR(100),
  location     VARCHAR(255),
  description  TEXT,
  metadata     JSONB   DEFAULT '{}',
  is_default   BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- REFERENCE_ADS — winning ads used for inspiration / style matching
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reference_ads (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id          UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  title             VARCHAR(255),
  platform          VARCHAR(50)  DEFAULT 'meta', -- meta | google | tiktok
  ad_format         VARCHAR(50),                 -- single_image | carousel | video | story
  headline          TEXT,
  body_text         TEXT,
  cta               VARCHAR(100),
  image_url         TEXT,
  file_path         TEXT,
  performance_score DECIMAL(3,2),
  tags              TEXT[]  DEFAULT '{}',
  notes             TEXT,
  metadata          JSONB   DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- TEMPLATES — reusable ad structures with variable slots
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS templates (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id       UUID REFERENCES brands(id) ON DELETE SET NULL, -- NULL = global
  name           VARCHAR(255) NOT NULL,
  description    TEXT,
  template_type  VARCHAR(50) NOT NULL, -- headline | body | cta | full_ad
  platform       VARCHAR(50) DEFAULT 'meta',
  ad_format      VARCHAR(50),
  structure      JSONB   NOT NULL DEFAULT '{}',  -- slot definitions
  variables      TEXT[]  DEFAULT '{}',           -- e.g. {{product_name}}
  example_output TEXT,
  is_global      BOOLEAN DEFAULT false,
  is_active      BOOLEAN DEFAULT true,
  tags           TEXT[]  DEFAULT '{}',
  metadata       JSONB   DEFAULT '{}',
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- CONCEPTS — ad briefs/ideas created before generation
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS concepts (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id           UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  persona_id         UUID REFERENCES brand_personas(id) ON DELETE SET NULL,
  template_id        UUID REFERENCES templates(id) ON DELETE SET NULL,
  title              VARCHAR(255) NOT NULL,
  objective          VARCHAR(100),  -- awareness | conversion | traffic | engagement
  product_name       VARCHAR(255),
  key_benefit        TEXT,
  tone               VARCHAR(100),  -- professional | playful | urgent | inspirational
  hook_type          VARCHAR(100),  -- question | statistic | story | pain_point
  platform           VARCHAR(50)  DEFAULT 'meta',
  ad_format          VARCHAR(50)  DEFAULT 'single_image',
  additional_context TEXT,
  status             VARCHAR(50)  DEFAULT 'draft', -- draft | ready | generating | completed | archived
  metadata           JSONB  DEFAULT '{}',
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- GENERATION_JOBS — async AI generation tracking
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS generation_jobs (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id         UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  concept_id       UUID REFERENCES concepts(id) ON DELETE SET NULL,
  job_type         VARCHAR(50) NOT NULL, -- generate_copy | generate_image | generate_full_ad | batch
  status           VARCHAR(50) DEFAULT 'queued', -- queued | processing | completed | failed | cancelled
  priority         INTEGER     DEFAULT 5,
  batch_size       INTEGER     DEFAULT 1,
  completed_count  INTEGER     DEFAULT 0,
  failed_count     INTEGER     DEFAULT 0,
  input_params     JSONB  DEFAULT '{}',
  output_summary   JSONB  DEFAULT '{}',
  error_message    TEXT,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  metadata         JSONB  DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- GENERATED_ADS — AI output, one row per ad variant
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS generated_ads (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id          UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  concept_id        UUID REFERENCES concepts(id) ON DELETE SET NULL,
  job_id            UUID REFERENCES generation_jobs(id) ON DELETE SET NULL,
  headline          TEXT,
  primary_text      TEXT,
  description       TEXT,
  cta               VARCHAR(100),
  image_prompt      TEXT,       -- prompt used for image generation
  image_url         TEXT,
  image_file_path   TEXT,
  platform          VARCHAR(50) DEFAULT 'meta',
  ad_format         VARCHAR(50),
  ai_model          VARCHAR(100),
  generation_params JSONB  DEFAULT '{}', -- temperature, max_tokens, etc.
  quality_score     DECIMAL(3,2),
  status            VARCHAR(50) DEFAULT 'draft', -- draft | approved | rejected | exported
  feedback          TEXT,
  metadata          JSONB  DEFAULT '{}',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ────────────────────────────────────────────────────────────
-- CAMPAIGNS — top-level workspace container
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  brand_id    UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  name        VARCHAR(255) NOT NULL,
  mode        VARCHAR(50)  DEFAULT 'remix',   -- remix | concepts
  status      VARCHAR(50)  DEFAULT 'active',  -- active | archived
  metadata    JSONB        DEFAULT '{}',
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- Add campaign_id to generated_ads (nullable for backward compatibility)
ALTER TABLE generated_ads ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;

-- Brand Kit columns — guards ensure existing databases are brought up to date
ALTER TABLE brands ADD COLUMN IF NOT EXISTS description            TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS primary_color          VARCHAR(20);
ALTER TABLE brands ADD COLUMN IF NOT EXISTS secondary_color        VARCHAR(20);
ALTER TABLE brands ADD COLUMN IF NOT EXISTS industry               VARCHAR(100);
ALTER TABLE brands ADD COLUMN IF NOT EXISTS target_audience        TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS brand_voice            TEXT;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS offer_cta              TEXT;
-- Typography identity columns
ALTER TABLE brands ADD COLUMN IF NOT EXISTS primary_font           VARCHAR(120);
ALTER TABLE brands ADD COLUMN IF NOT EXISTS secondary_font         VARCHAR(120);
ALTER TABLE brands ADD COLUMN IF NOT EXISTS headline_style         VARCHAR(120);
ALTER TABLE brands ADD COLUMN IF NOT EXISTS typography_personality TEXT;

-- ────────────────────────────────────────────────────────────
-- INDEXES — optimised for common access patterns
-- ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_brand_assets_brand_id     ON brand_assets(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_assets_type         ON brand_assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_brand_personas_brand_id   ON brand_personas(brand_id);
CREATE INDEX IF NOT EXISTS idx_reference_ads_brand_id    ON reference_ads(brand_id);
CREATE INDEX IF NOT EXISTS idx_templates_brand_id        ON templates(brand_id);
CREATE INDEX IF NOT EXISTS idx_templates_is_global       ON templates(is_global);
CREATE INDEX IF NOT EXISTS idx_concepts_brand_id         ON concepts(brand_id);
CREATE INDEX IF NOT EXISTS idx_concepts_status           ON concepts(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_brand_id         ON campaigns(brand_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status           ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_generated_ads_campaign_id  ON generated_ads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_generated_ads_brand_id     ON generated_ads(brand_id);
CREATE INDEX IF NOT EXISTS idx_generated_ads_concept_id  ON generated_ads(concept_id);
CREATE INDEX IF NOT EXISTS idx_generated_ads_status      ON generated_ads(status);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_brand_id  ON generation_jobs(brand_id);
CREATE INDEX IF NOT EXISTS idx_generation_jobs_status    ON generation_jobs(status);

-- ────────────────────────────────────────────────────────────
-- AUTO updated_at TRIGGER
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

DROP TRIGGER IF EXISTS update_users_updated_at           ON users;
DROP TRIGGER IF EXISTS update_brands_updated_at          ON brands;
DROP TRIGGER IF EXISTS update_brand_assets_updated_at    ON brand_assets;
DROP TRIGGER IF EXISTS update_brand_personas_updated_at  ON brand_personas;
DROP TRIGGER IF EXISTS update_reference_ads_updated_at   ON reference_ads;
DROP TRIGGER IF EXISTS update_templates_updated_at       ON templates;
DROP TRIGGER IF EXISTS update_concepts_updated_at        ON concepts;
DROP TRIGGER IF EXISTS update_generated_ads_updated_at   ON generated_ads;
DROP TRIGGER IF EXISTS update_generation_jobs_updated_at ON generation_jobs;
DROP TRIGGER IF EXISTS update_campaigns_updated_at       ON campaigns;

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_brands_updated_at
  BEFORE UPDATE ON brands FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_brand_assets_updated_at
  BEFORE UPDATE ON brand_assets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_brand_personas_updated_at
  BEFORE UPDATE ON brand_personas FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_reference_ads_updated_at
  BEFORE UPDATE ON reference_ads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_templates_updated_at
  BEFORE UPDATE ON templates FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_concepts_updated_at
  BEFORE UPDATE ON concepts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_generated_ads_updated_at
  BEFORE UPDATE ON generated_ads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_generation_jobs_updated_at
  BEFORE UPDATE ON generation_jobs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_campaigns_updated_at
  BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
