-- DOD data access · K-14 · step 4 of 4: ROLLBACK (only if the grant must be withdrawn). Run as the owner/DBA in
-- database dor_apims_master. Revokes only what 02_grant.sql gave; the dodmin account itself stays (it is DOD's
-- application account). DOD then answers 503 for scoped users (fail-closed).
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM dodmin;   -- also revokes the column privileges
REVOKE USAGE ON SCHEMA public FROM dodmin;
-- CONNECT is not revoked: PUBLIC has CONNECT on this database anyway (default ACL), so revoking it from dodmin changes nothing.
