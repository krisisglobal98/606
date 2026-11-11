-- DOD Minimal removed the Publish and Executive Summary menus. Their tables (created by the earlier version of
-- 005_publish_module.sql) are dropped from an existing database, but only when they hold no rows: a table with data
-- is kept and reported as a NOTICE, so this migration can never destroy data (for example if DOD_DB_NAME pointed at
-- a database that another application still fills). Children first, because of the foreign keys between them.
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY['dor_publish_run', 'dor_publication_version', 'dor_publication', 'dor_publish_template_file', 'dor_publish_template_version', 'dor_publish_template'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
      IF n = 0 THEN
        EXECUTE format('DROP TABLE public.%I', t);
      ELSE
        RAISE NOTICE 'DOD Minimal: % holds % rows and is kept', t, n;
      END IF;
    END IF;
  END LOOP;
END $$;
