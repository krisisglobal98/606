-- DOD Minimal: Report → Laporan PDF (reports, templates, generated HTML, Blast, Distribution History,
-- Penerima, Pengaturan Report/SMTP) was removed; Report keeps Laporan Operasional (dor_saved_report).
-- Only this application's own tables are touched. A table is dropped only when it is empty and no other
-- table still references it; otherwise it is kept (with a NOTICE) and no longer used.
-- dor_setting stays: the Dashboard keeps its configuration there.

DELETE FROM dor_role_menu WHERE menu_id IN ('report.reports', 'report.templates', 'report.blast', 'report.history', 'report.recipients', 'report.settings');
DELETE FROM dor_setting WHERE key IN ('report.smtp', 'report.general');

DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  -- children before parents
  FOREACH t IN ARRAY ARRAY['dor_delivery', 'dor_distribution', 'dor_recipient', 'dor_report_artifact', 'dor_report_template_version', 'dor_report', 'dor_report_template'] LOOP
    IF to_regclass(t) IS NULL THEN
      CONTINUE;
    END IF;
    EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
    IF n > 0 THEN
      RAISE NOTICE '% berisi % baris; tabel dibiarkan (tidak dipakai lagi).', t, n;
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE format('DROP TABLE %I', t);
    EXCEPTION WHEN dependent_objects_still_exist THEN
      RAISE NOTICE '% masih dirujuk tabel lain; tabel dibiarkan (tidak dipakai lagi).', t;
    END;
  END LOOP;
END $$;
