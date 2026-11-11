-- Menu permissions per role (Settings → Hak Akses Menu, server/src/access).
-- One row per role and menu the administrator saved. A menu without a row is allowed (the behaviour before this
-- table existed); menu ids come from the catalog in server/src/access/menus.ts, so a removed menu leaves a harmless row.
CREATE TABLE IF NOT EXISTS dor_role_menu (
  role       text NOT NULL CHECK (role IN ('admin', 'analyst', 'publisher', 'viewer')),
  menu_id    text NOT NULL CHECK (menu_id ~ '^[a-z][a-z0-9.-]{0,63}$'),
  allowed    boolean NOT NULL,
  updated_by text REFERENCES dor_user(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, menu_id)
);
