-- Keep the immutable origin after unlinking: revocation must not recreate a user.
CREATE TABLE IF NOT EXISTS entra_provisioned_members (
  member_id TEXT PRIMARY KEY REFERENCES members(id),
  tenant_id TEXT NOT NULL, object_id TEXT NOT NULL, created_at TEXT NOT NULL,
  UNIQUE(tenant_id,object_id)
);
