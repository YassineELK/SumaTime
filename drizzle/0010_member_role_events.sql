CREATE TABLE IF NOT EXISTS member_role_events (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  actor_id TEXT NOT NULL REFERENCES members(id),
  previous_role TEXT NOT NULL CHECK(previous_role IN ('admin','partner')),
  new_role TEXT NOT NULL CHECK(new_role IN ('admin','partner')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS member_role_events_member ON member_role_events(member_id,created_at);
