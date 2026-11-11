-- Adds the "publisher" role to the user table. This migration also created the tables of the Publish module; that
-- module is not part of DOD Minimal, so only the role change is kept here (a database that already ran the earlier
-- version keeps its tables until 017_remove_publish.sql drops them).

ALTER TABLE dor_user DROP CONSTRAINT IF EXISTS dor_user_role_check;
ALTER TABLE dor_user ADD CONSTRAINT dor_user_role_check CHECK (role IN ('admin', 'analyst', 'publisher', 'viewer'));
