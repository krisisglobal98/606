-- A connection from the server environment that an administrator deleted in DOD stays hidden (and
-- its datasets deleted) even while its DOD_DW_<P>_* variables are still present.
ALTER TABLE dw_connection ADD COLUMN IF NOT EXISTS removed_at timestamptz;
