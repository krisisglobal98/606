-- Data access assignments and dataset organization validation (docs/DATA_ACCESS.md, ORG_SCOPE_IMPLEMENTATION_PLAN.md §4).
-- Additive only: no existing row or column is changed or dropped. dor_user keeps every column (incl. the retired
-- level_code / *_code / ownership_code, unused for authorization from now on) so the previous version still runs.
-- No user receives an assignment here: users without an assignment see no report data until an access manager
-- assigns one (K-15).

CREATE TABLE IF NOT EXISTS dor_user_access (
  id         text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    text NOT NULL REFERENCES dor_user(id) ON DELETE CASCADE,
  -- Nine levels, in the required order: Kepemilikan … Divisi.
  level      text NOT NULL CHECK (level IN ('OWNERSHIP', 'GROUP', 'WILAYAH', 'REGION', 'GMK', 'COMPANY', 'BUSINESS_UNIT', 'RAYON', 'DIVISION')),
  -- Level of the organization part (= level; BUSINESS_UNIT for Rayon/Divisi; chosen for Kepemilikan).
  org_level  text NOT NULL CHECK (org_level IN ('GROUP', 'WILAYAH', 'REGION', 'GMK', 'COMPANY', 'BUSINESS_UNIT')),
  -- PIMS table of org_id and the id itself: never a code or a name.
  org_kind   text NOT NULL CHECK (org_kind IN ('ms_group', 'ms_so_node', 'ms_region', 'ms_gmk_header', 'ms_company', 'ms_businessunit')),
  org_id     text NOT NULL CHECK (org_id ~ '^[0-9]{1,20}$'),
  -- Rayon / Divisi: the rayon or division id inside the parent BU (org_id).
  sub_kind   text CHECK (sub_kind IN ('ms_rayon', 'ms_division')),
  sub_id     text CHECK (sub_id ~ '^[0-9]{1,20}$'),
  -- Kepemilikan: categories (INTI / PLASMA / KKPA), combined with the organization part by AND.
  ownership  text[],
  -- Display snapshot at assignment time; never used for authorization.
  label      text NOT NULL DEFAULT '',
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text REFERENCES dor_user(id) ON DELETE SET NULL,
  CONSTRAINT dor_user_access_shape CHECK (
    CASE level
      WHEN 'OWNERSHIP' THEN ownership IS NOT NULL AND cardinality(ownership) BETWEEN 1 AND 10 AND sub_kind IS NULL AND sub_id IS NULL
      WHEN 'RAYON' THEN org_level = 'BUSINESS_UNIT' AND org_kind = 'ms_businessunit' AND sub_kind = 'ms_rayon' AND sub_id IS NOT NULL AND ownership IS NULL
      WHEN 'DIVISION' THEN org_level = 'BUSINESS_UNIT' AND org_kind = 'ms_businessunit' AND sub_kind = 'ms_division' AND sub_id IS NOT NULL AND ownership IS NULL
      ELSE org_level = level AND sub_kind IS NULL AND sub_id IS NULL AND ownership IS NULL
    END),
  CONSTRAINT dor_user_access_kind CHECK (
    (org_level = 'GROUP' AND org_kind = 'ms_group') OR
    (org_level = 'WILAYAH' AND org_kind = 'ms_so_node') OR
    (org_level = 'REGION' AND org_kind IN ('ms_region', 'ms_so_node')) OR
    (org_level = 'GMK' AND org_kind = 'ms_gmk_header') OR
    (org_level = 'COMPANY' AND org_kind = 'ms_company') OR
    (org_level = 'BUSINESS_UNIT' AND org_kind = 'ms_businessunit'))
);
CREATE INDEX IF NOT EXISTS dor_user_access_user_idx ON dor_user_access (user_id);
-- One assignment per user × level × organization × sub × categories (categories stored sorted, upper case).
CREATE UNIQUE INDEX IF NOT EXISTS dor_user_access_unique_idx
  ON dor_user_access (user_id, level, org_kind, org_id, sub_kind, sub_id, ownership) NULLS NOT DISTINCT;

-- Validation of a dataset version's Business Unit values against the PIMS master (K-13). A dataset is used for
-- restricted users only when a validation of its current version (updated_at) is 'ok' or 'partial'.
CREATE TABLE IF NOT EXISTS dor_dataset_org_validation (
  dataset_id         text PRIMARY KEY REFERENCES dor_dataset(id) ON DELETE CASCADE,
  dataset_updated_at timestamptz NOT NULL,
  status             text NOT NULL CHECK (status IN ('ok', 'partial', 'failed')),
  checked_at         timestamptz NOT NULL DEFAULT now(),
  checked_by         text REFERENCES dor_user(id) ON DELETE SET NULL,
  detail             jsonb NOT NULL
);
