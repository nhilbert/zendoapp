-- OAuth for the MCP endpoint (server/oauth.ts): clients registered by agents (RFC 7591) and issued tokens.
-- Tokens are stored only as SHA-256 hashes; a refresh token and the access tokens issued with it share a family.
CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  client_id TEXT NOT NULL,
  family TEXT NOT NULL,
  user TEXT NOT NULL,
  resource TEXT,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS oauth_tokens_family ON oauth_tokens(family);
CREATE INDEX IF NOT EXISTS oauth_tokens_client ON oauth_tokens(client_id);
