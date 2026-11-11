-- Laporan Operasional: Analysis layouts saved by users (Analisis → Simpan Laporan, Report → Laporan Operasional).
-- Categories come from the master list, but a saved report is not part of a category's dataset count. A deleted
-- dataset leaves the report listed as unavailable, so nothing a user saved disappears without notice.
CREATE TABLE IF NOT EXISTS dor_saved_report (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  category_id text REFERENCES dor_category(id) ON DELETE SET NULL,
  dataset_id  text NOT NULL,
  layout      jsonb NOT NULL,
  created_by  text REFERENCES dor_user(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dor_saved_report_category_idx ON dor_saved_report (category_id);
