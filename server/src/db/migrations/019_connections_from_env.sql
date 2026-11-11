-- DOD Minimal: data warehouse connections come only from the server environment (.env:
-- DOD_DW_CONNECTIONS + DOD_DW_<PREFIX>_*). The page and API to add/change/delete/test connections
-- (Data → Data Warehouse) were removed, and with them connections added in the UI ("managed").
--
-- Every managed connection becomes an environment connection whose prefix is derived from its name
-- (e.g. "Postgres SQL" → POSTGRES_SQL → id postgres-sql); its datasets and query log follow the new id.
-- The stored (encrypted) password is dropped: the password now lives only in .env as
-- DOD_DW_<PREFIX>_PASSWORD. Until the connection is declared in .env, its datasets show the source as
-- not available. Only this application's own tables are touched.

DELETE FROM dor_role_menu WHERE menu_id = 'data.warehouse';

DO $$
DECLARE
  r record;
  prefix text;
  new_id text;
  n int;
BEGIN
  FOR r IN SELECT * FROM dw_connection WHERE origin = 'managed' ORDER BY created_at, id LOOP
    prefix := upper(trim(both '_' from regexp_replace(r.name, '[^A-Za-z0-9]+', '_', 'g')));
    IF prefix = '' THEN prefix := 'CONN'; END IF;
    IF prefix !~ '^[A-Z]' THEN prefix := 'C_' || prefix; END IF;
    new_id := lower(replace(prefix, '_', '-'));
    n := 1;
    WHILE EXISTS (SELECT 1 FROM dw_connection WHERE id = new_id) LOOP
      n := n + 1;
      new_id := lower(replace(prefix, '_', '-')) || '-' || n;
    END LOOP;
    IF n > 1 THEN prefix := prefix || '_' || n; END IF;

    INSERT INTO dw_connection (id, name, db_type, environment, host, port, database_name, username, password_secret, schema_name, ssl_mode,
                               connect_timeout_ms, command_timeout_ms, status, origin, password_enc, options, created_at, updated_at)
    VALUES (new_id, r.name, r.db_type, r.environment, r.host, r.port, r.database_name, r.username, 'DOD_DW_' || prefix || '_PASSWORD', r.schema_name, r.ssl_mode,
            r.connect_timeout_ms, r.command_timeout_ms, 'not_configured', 'env', NULL, r.options, r.created_at, now());
    UPDATE dor_dataset SET connection_id = new_id WHERE connection_id = r.id;
    UPDATE dor_query_log SET connection_id = new_id WHERE connection_id = r.id;
    DELETE FROM dw_connection WHERE id = r.id;
    RAISE NOTICE 'koneksi % (%) → .env prefix % (id %)', r.id, r.name, prefix, new_id;
  END LOOP;
END $$;
