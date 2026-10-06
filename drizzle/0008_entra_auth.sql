-- Additional identities preserve local/LDAP accounts and stable business member IDs.
CREATE TABLE IF NOT EXISTS entra_identities (
  member_id TEXT PRIMARY KEY REFERENCES members(id),
  tenant_id TEXT NOT NULL, object_id TEXT NOT NULL,
  linked_by TEXT NOT NULL REFERENCES members(id), created_at TEXT NOT NULL,
  UNIQUE(tenant_id,object_id)
);
CREATE TABLE IF NOT EXISTS entra_sessions (
  token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL, object_id TEXT NOT NULL
);
-- Do not cascade identity deletion to the session marker: a revoked Microsoft
-- session must never fall back to authenticating via the member's local account.
CREATE TABLE IF NOT EXISTS entra_flows (
  state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL,
  verifier TEXT NOT NULL, nonce TEXT NOT NULL, expires INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS entra_identity_events (
  id INTEGER PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
  actor_id TEXT NOT NULL REFERENCES members(id), action TEXT NOT NULL,
  tenant_id TEXT NOT NULL, object_id TEXT NOT NULL, created_at TEXT NOT NULL
);
