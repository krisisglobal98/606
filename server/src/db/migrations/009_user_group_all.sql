-- Group "ALL" (Settings → Pengguna): a user at level Group may be given every group instead of one.
-- dor_user.group_code then holds the reserved code 'ALL', which is not a row of the master copy dor_org_group.
-- The foreign key moves to a generated column that is NULL for 'ALL', so every real group code is still
-- checked against the master and nothing else changes for existing users.
ALTER TABLE dor_user DROP CONSTRAINT IF EXISTS dor_user_group_code_fkey;
ALTER TABLE dor_user
  ADD COLUMN IF NOT EXISTS group_code_ref text GENERATED ALWAYS AS (NULLIF(group_code, 'ALL')) STORED
    CONSTRAINT dor_user_group_code_ref_fkey REFERENCES dor_org_group(code);
COMMENT ON COLUMN dor_user.group_code IS 'Group scope: a dor_org_group code, or ALL for every group';
COMMENT ON COLUMN dor_user.group_code_ref IS 'group_code without ALL; carries the foreign key to dor_org_group';
