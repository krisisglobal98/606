-- DOD data access · K-14 · step 3 of 4: VERIFY. Run as the owner/DBA in database dor_apims_master after 02_grant.sql.
-- Only privilege checks: no write is attempted.

-- V1. Exactly 13 tables readable by dodmin (by column), no full-table SELECT, no write privilege.
--     EXPECTED: 13 rows, all tbl_select = false, any_col = true, write_any = false.
SELECT c.relname,
       has_table_privilege('dodmin', c.oid, 'SELECT')                                                  AS tbl_select,
       has_any_column_privilege('dodmin', c.oid, 'SELECT')                                             AS any_col,
       has_table_privilege('dodmin', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')   AS write_any
FROM pg_class c
WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
  AND (has_any_column_privilege('dodmin', c.oid, 'SELECT') OR has_table_privilege('dodmin', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))
ORDER BY 1;

-- V2. Forbidden tables. EXPECTED: can_read = false for every row.
SELECT t, has_any_column_privilege('dodmin', ('public.' || t)::regclass, 'SELECT') AS can_read
FROM unnest(ARRAY['ms_tenant','ms_user_header','ms_user_detail','ms_user_level','ms_user_login_history','ms_organization']) AS t;

-- V3. Not a superuser, no CREATE in schema public. EXPECTED: false, false.
SELECT rolsuper FROM pg_roles WHERE rolname = 'dodmin';
SELECT has_schema_privilege('dodmin', 'public', 'CREATE') AS can_create;

-- Then restart the DOD API: Settings → Pengguna shows "Master organisasi PIMS: Tersedia". DOD checks the account
-- itself on its first read (refuses a superuser, any write privilege in dor_apims_master, read access to
-- ms_tenant / ms_user_*, or CREATE) and reads only in READ ONLY sessions.
