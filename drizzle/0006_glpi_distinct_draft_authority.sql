-- Round 11: the guarded SQLite migration lives in db/raw.ts because this
-- deployment has no external migration runner. It adds draft_payload_json
-- and generation to pre-round-11 databases, tombstones duplicate live
-- generations, then installs this partial unique index.
--
-- Keep this DDL as the portable index part for backup/replay tooling; the
-- PRAGMA-guarded column migration in db/raw.ts must run first.
CREATE UNIQUE INDEX IF NOT EXISTS glpi_creation_intents_active_draft_unique
  ON glpi_creation_intents(member_id,api_url,draft_request_id)
  WHERE draft_request_id IS NOT NULL AND abandoned_at IS NULL AND used_at IS NULL;
CREATE INDEX IF NOT EXISTS glpi_creation_intents_draft_generation
  ON glpi_creation_intents(member_id,api_url,draft_request_id,generation);
