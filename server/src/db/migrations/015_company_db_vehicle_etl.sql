-- Which APIMS unit database belongs to which company, and the log of the vehicle ETL.
-- dor_company_db is filled from ms_company.companyAlias (dor_apims_<alias>) and the databases on the server; company_id
-- is the id in the master database (no foreign key: another database). A company can have no database (db_exists false).
CREATE TABLE IF NOT EXISTS dor_company_db (
  company_id    bigint PRIMARY KEY,
  company_code  text NOT NULL,
  company_name  text NOT NULL,
  company_alias text,
  database_name text,
  db_exists     boolean NOT NULL DEFAULT false,
  synced_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dor_company_db_alias_idx ON dor_company_db (lower(company_alias));

CREATE TABLE IF NOT EXISTS dor_etl_run (
  id            bigserial PRIMARY KEY,
  job           text NOT NULL,
  scope         text NOT NULL,
  database_name text,
  period        text,
  rows_read     integer NOT NULL DEFAULT 0,
  rows_written  integer NOT NULL DEFAULT 0,
  rows_skipped  integer NOT NULL DEFAULT 0,
  rows_removed  integer NOT NULL DEFAULT 0,
  status        text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  message       text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
