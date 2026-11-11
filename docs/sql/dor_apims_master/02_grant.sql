-- DOD data access · K-14 · step 2 of 4: GRANT (minimum SELECT) to the EXISTING DOD account dodmin (DOD_DB_USER).
-- No new role, no new password. Run as the owner/DBA in database dor_apims_master (e.g. psql -U postgres -d dor_apims_master
-- -f 02_grant.sql), only after 01_preflight.sql gave the expected results. DOD does not run this file.
--
-- Never granted: ms_user_* (incl. ms_user_login_history), ms_tenant (database credentials), ms_organization*,
-- transaction tables (trx_*, tr_*), any other table, INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER, CREATE,
-- EXECUTE on functions. DOD reads these tables in READ ONLY sessions and refuses the account at runtime if it can
-- write any table of dor_apims_master, is a superuser, or can read ms_tenant / ms_user_*.

BEGIN;
GRANT CONNECT ON DATABASE dor_apims_master TO dodmin;
GRANT USAGE ON SCHEMA public TO dodmin;

GRANT SELECT (id, code, name, is_active, is_deleted, valid_from, valid_to)                                        ON public.ms_group                TO dodmin;
GRANT SELECT (id, group_id, code, name, is_active, is_deleted, valid_from, valid_to)                              ON public.ms_region               TO dodmin;
GRANT SELECT (id, group_id, region_id, code, name, "companyAlias", "oracleCode", is_active, is_deleted, valid_from, valid_to) ON public.ms_company TO dodmin;
GRANT SELECT (id, company_id, code, name, is_active, is_deleted, valid_from, valid_to)                            ON public.ms_businessunit         TO dodmin;
GRANT SELECT (id, group_id, name, is_active, is_deleted, valid_from, valid_to)                                    ON public.ms_gmk_header           TO dodmin;
GRANT SELECT (id, gmkheader_id, company_id, businessunit_id, is_active, is_deleted, valid_from, valid_to)         ON public.ms_gmk_detail           TO dodmin;
GRANT SELECT (id, code, name, is_active, is_deleted, valid_from, valid_to)                                        ON public.ms_rayon                TO dodmin;
GRANT SELECT (id, code, name, is_active, is_deleted, valid_from, valid_to)                                        ON public.ms_division             TO dodmin;
GRANT SELECT (id, businessunit_id, division_id, is_active, is_deleted, valid_from, valid_to)                      ON public.ms_businessunitdivision TO dodmin;
GRANT SELECT (id, code, name, "level", parent_id, is_active, is_deleted, valid_from, valid_to)                    ON public.ms_so_structure         TO dodmin;
GRANT SELECT (id, structure_id, parent_id, code, name, is_gmk, is_virtual, is_active, is_deleted, valid_from, valid_to) ON public.ms_so_node      TO dodmin;
GRANT SELECT (id, so_node_id, businessunit_id, is_active, is_deleted, valid_from, valid_to)                       ON public.ms_so_node_businessunit TO dodmin;
GRANT SELECT (id, name, is_active, is_deleted, valid_from, valid_to)                                              ON public.ms_blockownership       TO dodmin;
COMMIT;
