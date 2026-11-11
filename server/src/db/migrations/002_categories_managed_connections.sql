-- Connections added in the DOD UI, and dataset categories (Kategori → Sub-kategori).

-- "env": defined in the server environment (secret name only). "managed": added by an administrator;
-- its password is stored encrypted with DOD_SECRET_KEY (AES-256-GCM), never in plain text.
ALTER TABLE dw_connection ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'env' CHECK (origin IN ('env', 'managed'));
ALTER TABLE dw_connection ADD COLUMN IF NOT EXISTS password_enc text;
ALTER TABLE dw_connection ADD COLUMN IF NOT EXISTS options jsonb NOT NULL DEFAULT '{}';
ALTER TABLE dw_connection ADD COLUMN IF NOT EXISTS created_by text REFERENCES dor_user(id) ON DELETE SET NULL;

-- Two levels: a category (parent_id NULL) and its sub-categories. A dataset belongs to one of either.
CREATE TABLE IF NOT EXISTS dor_category (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  description text NOT NULL DEFAULT '',
  parent_id   text REFERENCES dor_category(id) ON DELETE RESTRICT,
  sort_order  integer NOT NULL DEFAULT 0,
  created_by  text REFERENCES dor_user(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dor_category_name_idx ON dor_category (COALESCE(parent_id, ''), lower(name));

ALTER TABLE dor_dataset ADD COLUMN IF NOT EXISTS category_id text REFERENCES dor_category(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS dor_dataset_category_idx ON dor_dataset (category_id);
