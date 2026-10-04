import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = mkdtempSync('/dev/shm/sumatime-glpi-round11-migration-');
process.env.DATABASE_PATH = resolve(directory, 'round11-migration.sqlite');
const source = new DatabaseSync(process.env.DATABASE_PATH);
source.exec(readFileSync(resolve('drizzle/0000_spotty_luminals.sql'), 'utf8'));
source.exec(`INSERT INTO members(id,email,name,created_at) VALUES ('round11-migration-member','round11-migration@example.test','Round 11 migration','2026-01-01T00:00:00.000Z');
  CREATE TABLE glpi_creation_intents (
    intent_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, api_url TEXT NOT NULL,
    scope_request_id TEXT, draft_request_id TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
    abandoned_at TEXT, used_at TEXT, used_request_id TEXT, used_payload_hash TEXT, operation_request_id TEXT
  );`);
const draftId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
source.prepare(`INSERT INTO glpi_creation_intents
  (intent_id,member_id,api_url,draft_request_id,created_at,expires_at)
  VALUES (?,?,?,?,?,?)`).run('b'.repeat(64), 'round11-migration-member', 'http://127.0.0.1:8812/apirest.php', draftId, '2026-10-04T00:00:00.000Z', '2099-01-01T00:00:00.000Z');
source.prepare(`INSERT INTO glpi_creation_intents
  (intent_id,member_id,api_url,draft_request_id,created_at,expires_at)
  VALUES (?,?,?,?,?,?)`).run('c'.repeat(64), 'round11-migration-member', 'http://127.0.0.1:8812/apirest.php', draftId, '2026-10-04T00:00:00.000Z', '2099-01-01T00:00:00.000Z');
source.close();

const { sqlite } = await import('../db/raw.ts');
const db = sqlite();
const { beginGlpiDistinctCreation } = await import('../lib/glpi.ts');
const config = { api: 'http://127.0.0.1:8812/apirest.php', web: 'http://127.0.0.1:8812', appToken: '' };

test('migration adds payload/generation and leaves one active draft generation', () => {
  const columns = db.prepare('PRAGMA table_info(glpi_creation_intents)').all().map(row => row.name);
  assert.ok(columns.includes('draft_payload_json'));
  assert.ok(columns.includes('generation'));
  assert.match(String(db.prepare("SELECT sql FROM sqlite_master WHERE name='glpi_creation_intents_active_draft_unique'").get().sql), /UNIQUE INDEX/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM glpi_creation_intents WHERE member_id=? AND api_url=? AND draft_request_id=? AND abandoned_at IS NULL AND used_at IS NULL').get('round11-migration-member', config.api, draftId).n, 1);
  const result = beginGlpiDistinctCreation('round11-migration-member', config, undefined, draftId);
  assert.ok(result.intent_id);
  assert.equal(result.generation, 0);
});

