import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = mkdtempSync('/dev/shm/sumatime-glpi-round6-migration-');
process.env.DATABASE_PATH = resolve(directory, 'migration.sqlite');
process.env.GLPI_WRITE_ENABLED = 'true';
const source = new DatabaseSync(process.env.DATABASE_PATH);
source.exec(readFileSync(resolve('drizzle/0000_spotty_luminals.sql'), 'utf8'));
source.exec(`INSERT INTO members(id,email,name,created_at) VALUES ('migration-member','migration@example.test','Migration','2026-01-01T00:00:00.000Z');
  CREATE TABLE glpi_creations (
    request_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, api_url TEXT NOT NULL,
    payload_hash TEXT NOT NULL, payload_json TEXT, result_json TEXT, acknowledged_at TEXT,
    expires_at TEXT, legacy_state TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE glpi_creation_aliases (
    alias_request_id TEXT PRIMARY KEY, operation_request_id TEXT NOT NULL, member_id TEXT NOT NULL,
    api_url TEXT NOT NULL, payload_hash TEXT NOT NULL, result_json TEXT, created_at TEXT NOT NULL, expires_at TEXT
  );`);
const api = 'http://127.0.0.1:8797/apirest.php';
const input = request_id => ({ request_id, client_id: 'migration-client', title: 'Historical same fingerprint', description: 'Two provider results are distinct', type: 1, urgency: 3, category: 0 });
const hash = createHash('sha256').update(JSON.stringify(['migration-client', 'Historical same fingerprint', 'Two provider results are distinct', 1, 3, 0])).digest('hex');
const first = input('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
const second = input('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
const ticket118 = { id: 118, title: first.title, status: 1, entity: 4, url: 'http://127.0.0.1:8797/front/ticket.form.php?id=118', client_id: null, client: null };
const ticket119 = { id: 119, title: second.title, status: 1, entity: 4, url: 'http://127.0.0.1:8797/front/ticket.form.php?id=119', client_id: null, client: null };
source.exec(`INSERT INTO glpi_creations(request_id,member_id,api_url,payload_hash,payload_json,result_json,acknowledged_at,expires_at,legacy_state,created_at)
  VALUES ('${first.request_id}','migration-member','${api}','${hash}','${JSON.stringify(first).replaceAll("'", "''")}','${JSON.stringify(ticket118).replaceAll("'", "''")}','2026-01-01T00:00:00.123Z','2026-01-31 00:00:00','completed','2026-01-01T00:00:00.123Z'),
         ('${second.request_id}','migration-member','${api}','${hash}','${JSON.stringify(second).replaceAll("'", "''")}','${JSON.stringify(ticket119).replaceAll("'", "''")}','2026-01-02T00:00:00.456Z','2026-02-01 00:00:00','completed','2026-01-02T00:00:00.456Z');
  INSERT INTO glpi_creation_aliases VALUES ('${first.request_id}','${first.request_id}','migration-member','${api}','${hash}','${JSON.stringify(ticket118).replaceAll("'", "''")}','2026-01-01T00:00:00.123Z','2026-01-31 00:00:00');
  INSERT INTO glpi_creation_aliases VALUES ('${second.request_id}','${first.request_id}','migration-member','${api}','${hash}','${JSON.stringify(ticket118).replaceAll("'", "''")}','2026-01-02T00:00:00.456Z','2026-02-01 00:00:00');`);
source.close();

const { sqlite } = await import('../db/raw.ts');
const db = sqlite();
const { acknowledgeGlpiCreationResult, createGlpiTicket, glpiUncertainRequests } = await import('../lib/glpi.ts');
globalThis.fetch = async () => { throw new Error('migration replay must not call GLPI'); };

test('migration preserves completed 118/119 identity, ticket mapping, ACK and exact ISO boundary', async () => {
  const rows = db.prepare('SELECT request_id,state,result_json,expires_at FROM glpi_creations ORDER BY request_id').all();
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => [row.request_id, row.state, JSON.parse(row.result_json).id]), [
    [first.request_id, 'completed', 118],
    [second.request_id, 'completed', 119],
  ]);
  assert.equal(rows[0].expires_at, '2026-01-31T00:00:00.123Z', '30-day migration expiry keeps T, milliseconds and exact boundary');
  assert.equal(rows[1].expires_at, '2026-02-01T00:00:00.456Z');
  const aliases = db.prepare('SELECT alias_request_id,operation_request_id FROM glpi_creation_aliases ORDER BY alias_request_id').all();
  assert.deepEqual(aliases.map(row => [row.alias_request_id, row.operation_request_id]), [
    [first.request_id, first.request_id],
    [second.request_id, second.request_id],
  ], 'a historical completed UUID cannot remain redirected to another completed ticket');

  const replay118 = await createGlpiTicket('migration-member', { api, web: 'http://127.0.0.1:8797', appToken: '' }, first);
  const replay119 = await createGlpiTicket('migration-member', { api, web: 'http://127.0.0.1:8797', appToken: '' }, second);
  assert.equal(replay118.ticket.id, 118);
  assert.equal(replay119.ticket.id, 119);
  assert.equal(acknowledgeGlpiCreationResult('migration-member', api, first.request_id, 118).ok, true);
  assert.equal(acknowledgeGlpiCreationResult('migration-member', api, second.request_id, 119).ok, true);
  assert.equal(acknowledgeGlpiCreationResult('migration-member', api, first.request_id, 119).ok, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM glpi_creations').get().n, 2, 'migration creates no replacement operation rows');
  assert.deepEqual(glpiUncertainRequests('migration-member', api), { requests: [], blocked: false });
});
