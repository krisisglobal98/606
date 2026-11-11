-- DOD metadata database. Lives in DOD's own PostgreSQL, never in an external source database.

CREATE TABLE IF NOT EXISTS dor_user (
  id            text PRIMARY KEY,
  username      text NOT NULL UNIQUE,
  name          text NOT NULL,
  role          text NOT NULL CHECK (role IN ('admin', 'analyst', 'viewer')),
  password_hash text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dor_session (
  token_hash text PRIMARY KEY,
  user_id    text NOT NULL REFERENCES dor_user(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS dor_session_expires_idx ON dor_session (expires_at);

-- External data warehouse connections. Holds the *name* of the secret, never the password.
CREATE TABLE IF NOT EXISTS dw_connection (
  id                 text PRIMARY KEY,
  name               text NOT NULL,
  db_type            text NOT NULL,
  environment        text NOT NULL,
  host               text NOT NULL,
  port               integer NOT NULL,
  database_name      text NOT NULL,
  username           text NOT NULL,
  password_secret    text NOT NULL,
  schema_name        text NOT NULL,
  ssl_mode           text NOT NULL,
  connect_timeout_ms integer NOT NULL,
  command_timeout_ms integer NOT NULL,
  status             text NOT NULL DEFAULT 'untested' CHECK (status IN ('untested', 'connected', 'failed', 'not_configured')),
  last_tested_at     timestamptz,
  last_test          jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dor_dataset (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  description   text NOT NULL DEFAULT '',
  connection_id text NOT NULL REFERENCES dw_connection(id),
  schema_name   text NOT NULL,
  source_tables text[] NOT NULL,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('draft', 'active', 'archived')),
  semantic      jsonb NOT NULL,
  created_by    text REFERENCES dor_user(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dor_dataset_name_idx ON dor_dataset (lower(name)) WHERE status <> 'archived';

-- Performance metrics of every query DOD runs against a source (no SQL text, no parameters).
CREATE TABLE IF NOT EXISTS dor_query_log (
  id            bigserial PRIMARY KEY,
  started_at    timestamptz NOT NULL,
  ended_at      timestamptz NOT NULL,
  duration_ms   integer NOT NULL,
  connection_id text NOT NULL,
  dataset_id    text,
  user_id       text,
  kind          text NOT NULL,
  status        text NOT NULL,
  rows_returned integer,
  error_code    text
);
CREATE INDEX IF NOT EXISTS dor_query_log_started_idx ON dor_query_log (started_at DESC);

CREATE TABLE IF NOT EXISTS dor_audit (
  id      bigserial PRIMARY KEY,
  at      timestamptz NOT NULL DEFAULT now(),
  user_id text,
  action  text NOT NULL,
  target  text,
  detail  jsonb
);
CREATE INDEX IF NOT EXISTS dor_audit_at_idx ON dor_audit (at DESC);
