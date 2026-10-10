-- Supplier remuneration is separate from all client sale agreements.
CREATE TABLE IF NOT EXISTS provider_rates (
  member_id TEXT NOT NULL REFERENCES members(id),
  effective_from TEXT NOT NULL,
  hourly_rate_cents INTEGER CHECK(hourly_rate_cents IS NULL OR hourly_rate_cents BETWEEN 0 AND 99999999),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  actor_id TEXT NOT NULL REFERENCES members(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(member_id,effective_from)
);
CREATE TABLE IF NOT EXISTS provider_rate_events (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  actor_id TEXT NOT NULL REFERENCES members(id),
  effective_from TEXT NOT NULL,
  previous_rate_cents INTEGER,
  new_rate_cents INTEGER,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS provider_rate_events_member ON provider_rate_events(member_id,created_at);
