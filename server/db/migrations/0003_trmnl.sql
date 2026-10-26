-- TRMNL displays (server/trmnl.ts): one row per installation of the Zendo plugin, keyed by the hash of the
-- access token TRMNL sends with every screen request. Active once TRMNL confirmed the installation.
CREATE TABLE IF NOT EXISTS trmnl_connections (
  hash TEXT PRIMARY KEY,
  view TEXT NOT NULL,
  user TEXT NOT NULL,
  user_uuid TEXT,
  account TEXT,
  plugin_setting_id TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX IF NOT EXISTS trmnl_connections_uuid ON trmnl_connections(user_uuid);
