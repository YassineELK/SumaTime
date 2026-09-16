ALTER TABLE clients ADD COLUMN glpi_entity_id INTEGER CHECK(glpi_entity_id IS NULL OR glpi_entity_id >= 0);
CREATE UNIQUE INDEX clients_glpi_entity_unique ON clients(glpi_entity_id) WHERE glpi_entity_id IS NOT NULL;
CREATE TABLE work_timers (
  member_id TEXT PRIMARY KEY REFERENCES members(id),
  id TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL REFERENCES clients(id),
  ticket TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  on_site INTEGER NOT NULL CHECK(on_site IN (0,1)),
  started_at INTEGER NOT NULL,
  stopped_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE timer_receipts (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  entry_ids TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE glpi_credentials (
  member_id TEXT PRIMARY KEY REFERENCES members(id),
  api_url TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
