-- Report module: reports and versioned templates (definitions over a DOD dataset), generated HTML
-- artifacts, recipients, distributions with per-recipient deliveries, and module settings (SMTP).

CREATE TABLE IF NOT EXISTS dor_report_template (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  category    text NOT NULL,
  description text NOT NULL DEFAULT '',
  active      boolean NOT NULL DEFAULT true,
  version     text NOT NULL,
  definition  jsonb NOT NULL,
  owner_id    text REFERENCES dor_user(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dor_report_template_version (
  template_id text NOT NULL REFERENCES dor_report_template(id) ON DELETE CASCADE,
  version     text NOT NULL,
  definition  jsonb NOT NULL,
  note        text NOT NULL,
  author_id   text REFERENCES dor_user(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (template_id, version)
);

CREATE TABLE IF NOT EXISTS dor_report (
  id                  text PRIMARY KEY,
  name                text NOT NULL,
  status              text NOT NULL CHECK (status IN ('draft', 'configured', 'generated', 'distributed', 'archived')),
  template_id         text REFERENCES dor_report_template(id) ON DELETE SET NULL,
  template_version    text,
  definition          jsonb NOT NULL,
  origin              jsonb NOT NULL,
  owner_id            text REFERENCES dor_user(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  last_generated_at   timestamptz,
  last_distributed_at timestamptz
);

-- One generated HTML document (and the aggregated CSV of its tables), with the parameters used.
CREATE TABLE IF NOT EXISTS dor_report_artifact (
  id               text PRIMARY KEY,
  report_id        text NOT NULL REFERENCES dor_report(id) ON DELETE CASCADE,
  report_name      text NOT NULL,
  html             text NOT NULL,
  csv              text NOT NULL DEFAULT '',
  parameters       jsonb NOT NULL,
  period_label     text NOT NULL,
  template_version text,
  warnings         jsonb NOT NULL DEFAULT '[]',
  bytes            integer NOT NULL,
  generated_at     timestamptz NOT NULL DEFAULT now(),
  created_by       text REFERENCES dor_user(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS dor_report_artifact_report_idx ON dor_report_artifact (report_id, generated_at DESC);

CREATE TABLE IF NOT EXISTS dor_recipient (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  organization text NOT NULL DEFAULT '',
  role         text NOT NULL DEFAULT '',
  email        text,
  phone        text,
  telegram     text,
  kind         text NOT NULL DEFAULT 'person' CHECK (kind IN ('person', 'group')),
  preferred    text NOT NULL DEFAULT 'email' CHECK (preferred IN ('email', 'whatsapp', 'telegram')),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'unverified')),
  groups       text[] NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dor_distribution (
  id               text PRIMARY KEY,
  report_id        text NOT NULL REFERENCES dor_report(id) ON DELETE CASCADE,
  report_name      text NOT NULL,
  template_name    text,
  template_version text,
  parameters       jsonb NOT NULL,
  period_label     text NOT NULL,
  channels         text[] NOT NULL,
  channel_mode     text NOT NULL,
  recipient_ids    text[] NOT NULL,
  subject          text NOT NULL DEFAULT '',
  message          text NOT NULL DEFAULT '',
  chat_message     text NOT NULL DEFAULT '',
  attach_html      boolean NOT NULL DEFAULT false,
  attach_csv       boolean NOT NULL DEFAULT false,
  artifact_id      text REFERENCES dor_report_artifact(id) ON DELETE SET NULL,
  status           text NOT NULL CHECK (status IN ('pending', 'processing', 'sent', 'delivered', 'partial', 'failed', 'cancelled')),
  trigger          text NOT NULL CHECK (trigger IN ('manual', 'scheduled', 'retry')),
  attempt          integer NOT NULL DEFAULT 1,
  parent_id        text REFERENCES dor_distribution(id) ON DELETE SET NULL,
  error            text,
  scheduled_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  sent_at          timestamptz,
  completed_at     timestamptz,
  created_by       text REFERENCES dor_user(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS dor_distribution_created_idx ON dor_distribution (created_at DESC);
CREATE INDEX IF NOT EXISTS dor_distribution_due_idx ON dor_distribution (status, scheduled_at);

CREATE TABLE IF NOT EXISTS dor_delivery (
  id              bigserial PRIMARY KEY,
  distribution_id text NOT NULL REFERENCES dor_distribution(id) ON DELETE CASCADE,
  recipient_id    text NOT NULL,
  recipient_name  text NOT NULL,
  organization    text NOT NULL DEFAULT '',
  channel         text NOT NULL,
  target          text NOT NULL,
  status          text NOT NULL CHECK (status IN ('pending', 'processing', 'sent', 'delivered', 'failed', 'skipped')),
  error_code      text,
  error           text,
  at              timestamptz
);
CREATE INDEX IF NOT EXISTS dor_delivery_distribution_idx ON dor_delivery (distribution_id);

-- Module settings (e.g. report.smtp). A secret (SMTP password) is stored encrypted with DOD_SECRET_KEY.
CREATE TABLE IF NOT EXISTS dor_setting (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  secret_enc text,
  updated_by text REFERENCES dor_user(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
