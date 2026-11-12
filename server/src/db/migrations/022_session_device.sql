-- One device, one signed-in user (docs/SECURITY.md). A session remembers the client address it was opened from, so
-- a different user signing in from that address while the session is valid is refused (DEVICE_IN_USE) unless they
-- sign the first user out of the device. Additive only: sessions opened before this migration have no address and
-- are never treated as holding a device.

ALTER TABLE dor_session ADD COLUMN IF NOT EXISTS client_ip text;
CREATE INDEX IF NOT EXISTS dor_session_client_ip_idx ON dor_session (client_ip) WHERE client_ip IS NOT NULL;
