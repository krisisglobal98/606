-- User management and organization scope (docs/USERS_AND_ACCESS.md).
-- Additive only: existing users, ids and references are not changed, and every new column is nullable,
-- so older DOD code running against the same database keeps working.

-- Organization master: DOD's copy of dor_apims_master, filled by the organization sync (server/src/org).
-- Rows are never deleted by the sync; a code that disappears or is deactivated in the source gets active = false.
CREATE TABLE IF NOT EXISTS dor_org_group (
  code      text PRIMARY KEY,               -- ms_group.code
  name      text NOT NULL,
  source_id bigint NOT NULL,
  active    boolean NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);
-- ms_region holds one row per group for the same region; the code is the business identifier.
CREATE TABLE IF NOT EXISTS dor_org_region (
  code        text PRIMARY KEY,             -- ms_region.code
  name        text NOT NULL,
  group_codes text[] NOT NULL DEFAULT '{}',
  source_ids  bigint[] NOT NULL,
  active      boolean NOT NULL,
  synced_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dor_org_company (
  code        text PRIMARY KEY,             -- ms_company.code
  name        text NOT NULL,
  group_code  text,
  region_code text,
  source_id   bigint NOT NULL,
  active      boolean NOT NULL,
  synced_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dor_org_operational_unit (
  code         text PRIMARY KEY,            -- ms_businessunit.code
  name         text NOT NULL,
  company_code text,
  source_id    bigint NOT NULL,
  active       boolean NOT NULL,
  synced_at    timestamptz NOT NULL DEFAULT now()
);
-- ms_gmk_header has no code column; its name is the GMK code (decision D3).
CREATE TABLE IF NOT EXISTS dor_org_gmk (
  code       text PRIMARY KEY,              -- ms_gmk_header.name
  name       text NOT NULL,
  group_code text,
  source_id  bigint NOT NULL,
  active     boolean NOT NULL,
  synced_at  timestamptz NOT NULL DEFAULT now()
);
-- ms_gmk_detail: the operational units of a GMK (a unit may belong to several GMK).
CREATE TABLE IF NOT EXISTS dor_org_gmk_unit (
  gmk_code              text NOT NULL REFERENCES dor_org_gmk(code),
  operational_unit_code text NOT NULL REFERENCES dor_org_operational_unit(code),
  active                boolean NOT NULL,
  synced_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gmk_code, operational_unit_code)
);
CREATE INDEX IF NOT EXISTS dor_org_gmk_unit_unit_idx ON dor_org_gmk_unit (operational_unit_code);
CREATE TABLE IF NOT EXISTS dor_org_rayon (
  code      text PRIMARY KEY,               -- ms_rayon.code (Org Level 1)
  name      text NOT NULL,
  source_id bigint NOT NULL,
  active    boolean NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS dor_org_division (
  code      text PRIMARY KEY,               -- ms_division.code (Org Level 2)
  name      text NOT NULL,
  source_id bigint NOT NULL,
  active    boolean NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);

-- dor_user: the single user table. role stays the DOD application permission; level and codes are the
-- organization scope; ownership_code is separate from role; identity_issuer + external_subject is the SSO identity.
ALTER TABLE dor_user ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE dor_user
  ADD COLUMN IF NOT EXISTS level_code            text,
  ADD COLUMN IF NOT EXISTS ownership_code        text,
  ADD COLUMN IF NOT EXISTS owner_code            text,   -- no master source yet: stays NULL
  ADD COLUMN IF NOT EXISTS group_code            text REFERENCES dor_org_group(code),
  ADD COLUMN IF NOT EXISTS region_code           text REFERENCES dor_org_region(code),
  ADD COLUMN IF NOT EXISTS wilayah_code          text,   -- no master source yet: stays NULL
  ADD COLUMN IF NOT EXISTS gmk_code              text REFERENCES dor_org_gmk(code),
  ADD COLUMN IF NOT EXISTS company_code          text REFERENCES dor_org_company(code),
  ADD COLUMN IF NOT EXISTS operational_unit_code text REFERENCES dor_org_operational_unit(code),
  ADD COLUMN IF NOT EXISTS org_level_1_code      text REFERENCES dor_org_rayon(code),
  ADD COLUMN IF NOT EXISTS org_level_2_code      text REFERENCES dor_org_division(code),
  ADD COLUMN IF NOT EXISTS org_level_3_code      text,   -- this integration: always NULL
  ADD COLUMN IF NOT EXISTS identity_issuer       text,
  ADD COLUMN IF NOT EXISTS external_subject      text,
  ADD COLUMN IF NOT EXISTS updated_by            text;

ALTER TABLE dor_user DROP CONSTRAINT IF EXISTS dor_user_level_check;
ALTER TABLE dor_user ADD CONSTRAINT dor_user_level_check
  CHECK (level_code IN ('OWNER', 'GROUP', 'REGION', 'WILAYAH', 'GMK', 'COMPANY', 'OPERATIONAL_UNIT', 'ORG_LEVEL_1', 'ORG_LEVEL_2', 'ORG_LEVEL_3'));
ALTER TABLE dor_user DROP CONSTRAINT IF EXISTS dor_user_ownership_check;
ALTER TABLE dor_user ADD CONSTRAINT dor_user_ownership_check CHECK (ownership_code IN ('VIP', 'Admin'));
-- Both SSO columns are set, or neither.
ALTER TABLE dor_user DROP CONSTRAINT IF EXISTS dor_user_sso_pair_check;
ALTER TABLE dor_user ADD CONSTRAINT dor_user_sso_pair_check CHECK ((identity_issuer IS NULL) = (external_subject IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS dor_user_sso_identity_idx ON dor_user (identity_issuer, external_subject) WHERE identity_issuer IS NOT NULL;
-- Sign-in compares usernames case-insensitively, so two users must not differ only in case.
CREATE UNIQUE INDEX IF NOT EXISTS dor_user_username_lower_idx ON dor_user (lower(username));
