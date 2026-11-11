-- DOD Minimal removed Laporan Excel (dor_xl_project, dor_xl_step, dor_xl_query: migrations 007 and 011) and the
-- curah hujan aktual of the GIS Beranda (dor_rainfall_actual: migrations 013 and 014). Those migration files are no
-- longer part of DOD Minimal, so a new database never gets these tables.
--
-- In an existing database a table is dropped only when it holds no rows. A table with data is kept (and reported as
-- a NOTICE), so this migration can never destroy data, for example if DOD_DB_NAME pointed at a database that another
-- application still fills.
DO $$
DECLARE
  t text;
  n bigint;
BEGIN
  -- children first (dor_xl_step and dor_xl_query reference dor_xl_project)
  FOREACH t IN ARRAY ARRAY['dor_xl_step', 'dor_xl_query', 'dor_xl_project', 'dor_rainfall_actual'] LOOP
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
