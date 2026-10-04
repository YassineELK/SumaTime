import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = mkdtempSync('/dev/shm/sumatime-glpi-round10-migration-');
process.env.DATABASE_PATH = resolve(directory, 'round10-migration.sqlite');
const source = new DatabaseSync(process.env.DATABASE_PATH);
source.exec(readFileSync(resolve('drizzle/0000_spotty_luminals.sql'), 'utf8'));
source.exec(`INSERT INTO members(id,email,name,created_at) VALUES ('round10-migration-member','round10-migration@example.test','Round 10 migration','2026-01-01T00:00:00.000Z');
  CREATE TABLE glpi_creation_intents (
    intent_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, api_url TEXT NOT NULL,
    scope_request_id TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
    abandoned_at TEXT, used_at TEXT, used_request_id TEXT, used_payload_hash TEXT, operation_request_id TEXT
  );`);
source.close();

const { sqlite } = await import('../db/raw.ts');
const { beginGlpiDistinctCreation } = await import('../lib/glpi.ts');
const db = sqlite();
const config = { api: 'http://127.0.0.1:8811/apirest.php', web: 'http://127.0.0.1:8811', appToken: '' };

test('migration adds the durable draft UUID binding to pre-round10 intent rows', () => {
  const columns = db.prepare('PRAGMA table_info(glpi_creation_intents)').all().map(row => row.name);
  assert.ok(columns.includes('draft_request_id'));
  const requestId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const intent = beginGlpiDistinctCreation('round10-migration-member', config, undefined, requestId);
  const row = db.prepare('SELECT draft_request_id FROM glpi_creation_intents WHERE intent_id=?').get(intent.intent_id);
  assert.equal(row.draft_request_id, requestId);
});
