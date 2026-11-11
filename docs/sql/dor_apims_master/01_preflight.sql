-- DOD data access · K-14 · step 1 of 4: PREFLIGHT (read-only). Run as the DBA in database dor_apims_master.
-- DOD does not run this file. Expected results are stated per query; anything else: stop and review.

-- P1. Every column to be granted exists. EXPECTED: 0 rows.
WITH need(t, cols) AS (VALUES
  ('ms_group',               ARRAY['id','code','name','is_active','is_deleted','valid_from','valid_to']),
  ('ms_region',              ARRAY['id','group_id','code','name','is_active','is_deleted','valid_from','valid_to']),
  ('ms_company',             ARRAY['id','group_id','region_id','code','name','companyAlias','oracleCode','is_active','is_deleted','valid_from','valid_to']),
  ('ms_businessunit',        ARRAY['id','company_id','code','name','is_active','is_deleted','valid_from','valid_to']),
  ('ms_gmk_header',          ARRAY['id','group_id','name','is_active','is_deleted','valid_from','valid_to']),
  ('ms_gmk_detail',          ARRAY['id','gmkheader_id','company_id','businessunit_id','is_active','is_deleted','valid_from','valid_to']),
  ('ms_rayon',               ARRAY['id','code','name','is_active','is_deleted','valid_from','valid_to']),
  ('ms_division',            ARRAY['id','code','name','is_active','is_deleted','valid_from','valid_to']),
  ('ms_businessunitdivision',ARRAY['id','businessunit_id','division_id','is_active','is_deleted','valid_from','valid_to']),
  ('ms_so_structure',        ARRAY['id','code','name','level','parent_id','is_active','is_deleted','valid_from','valid_to']),
  ('ms_so_node',             ARRAY['id','structure_id','parent_id','code','name','is_gmk','is_virtual','is_active','is_deleted','valid_from','valid_to']),
  ('ms_so_node_businessunit',ARRAY['id','so_node_id','businessunit_id','is_active','is_deleted','valid_from','valid_to']),
  ('ms_blockownership',      ARRAY['id','name','is_active','is_deleted','valid_from','valid_to']))
SELECT t, c FROM need, unnest(cols) AS c
WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns ic WHERE ic.table_schema = 'public' AND ic.table_name = t AND ic.column_name = c);

-- P2. The existing DOD account (no new role is created). EXPECTED: 1 row, rolsuper = false, rolbypassrls = false.
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = 'dodmin';
-- Its current privileges in this database. EXPECTED (before the grant): 0 rows.
SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r','p','v','m','f')
  AND (has_any_column_privilege('dodmin', c.oid, 'SELECT') OR has_table_privilege('dodmin', c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'));

-- P3. Privileges of PUBLIC on tables and columns (they apply to EVERY role, the new one included). EXPECTED: 0 rows each.
SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE table_schema = 'public' AND grantee = 'PUBLIC';
SELECT table_name, column_name, privilege_type FROM information_schema.column_privileges WHERE table_schema = 'public' AND grantee = 'PUBLIC';

-- P4. Default privileges that would grant future tables to PUBLIC. Review every row.
SELECT defaclrole::regrole, defaclnamespace::regnamespace, defaclobjtype, defaclacl FROM pg_default_acl;

-- P5. Functions of schema public. EXPECTED: security_definer = false for all.
--     generate_businessunit_code(text,text) WRITES businessunit_counter; with security_definer = false a role without
--     write privileges (and in a read-only session) cannot write through it. If true: DBA decision (not part of DOD's request).
SELECT p.oid::regprocedure AS fn, p.prosecdef AS security_definer, p.proacl FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace ORDER BY 1;

-- P6. PUBLIC may not CREATE in schema public (PostgreSQL 15+ default). EXPECTED: false.
SELECT has_schema_privilege('public', 'public', 'CREATE') AS public_can_create;

-- dodmin already connects to this server (DOD application database); pg_hba.conf needs no change.
