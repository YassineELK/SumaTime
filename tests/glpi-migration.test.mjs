import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('an exact pre-payload GLPI schema migrates legacy results out of the blocker', async () => {
  const directory = mkdtempSync('/dev/shm/sumatime-glpi-migration-');
  process.env.DATABASE_PATH = resolve(directory, 'legacy.sqlite');
  const source = new DatabaseSync(process.env.DATABASE_PATH);
  source.exec(readFileSync(resolve('drizzle/0000_spotty_luminals.sql'), 'utf8'));
  source.exec(`CREATE TABLE glpi_creations (
    request_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, api_url TEXT NOT NULL,
    payload_hash TEXT NOT NULL, result_json TEXT, created_at TEXT NOT NULL
  );
  INSERT INTO members(id,email,name,created_at) VALUES ('legacy-member','legacy@example.test','Legacy','2026-01-01');
  INSERT INTO glpi_creations VALUES (
    '11111111-1111-1111-1111-111111111111','legacy-member','http://127.0.0.1:8790/apirest.php','legacy-hash',
    '{"id":301,"title":"Legacy result","status":1,"entity":4,"url":"http://127.0.0.1:8790/front/ticket.form.php?id=301","client_id":null,"client":null}',
    '2026-01-01T00:00:00.000Z'
  );`);
  source.close();
  const { sqlite } = await import('../db/raw.ts');
  const { glpiUncertainRequests } = await import('../lib/glpi.ts');
  const db = sqlite();
  const migrated = db.prepare('SELECT payload_json,result_json,acknowledged_at FROM glpi_creations WHERE request_id=?').get('11111111-1111-1111-1111-111111111111');
  assert.equal(migrated.payload_json, null);
  assert.ok(migrated.result_json);
  assert.equal(migrated.acknowledged_at, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(glpiUncertainRequests('legacy-member', 'http://127.0.0.1:8790/apirest.php'), { requests: [], blocked: false });
  assert.match(String(db.prepare("SELECT sql FROM sqlite_master WHERE name='glpi_creations_live_fingerprint_unique'").get().sql), /UNIQUE INDEX/);
});
