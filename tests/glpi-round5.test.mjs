import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = mkdtempSync('/dev/shm/sumatime-glpi-round5-');
process.env.DATABASE_PATH = resolve(directory, 'round5.sqlite');
process.env.GLPI_WRITE_ENABLED = 'true';
const source = new DatabaseSync(process.env.DATABASE_PATH);
source.exec(readFileSync(resolve('drizzle/0000_spotty_luminals.sql'), 'utf8'));
source.exec(`
  INSERT INTO members(id,email,name,created_at) VALUES
    ('legacy-member','legacy@example.test','Legacy','2026-01-01'),
    ('legacy-two','legacy-two@example.test','Legacy Two','2026-01-01'),
    ('alias-member','alias@example.test','Alias','2026-01-01');
  CREATE TABLE glpi_creations (
    request_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, api_url TEXT NOT NULL,
    payload_hash TEXT NOT NULL, result_json TEXT, created_at TEXT NOT NULL
  );
  INSERT INTO glpi_creations VALUES
    ('11111111-1111-1111-1111-111111111111','legacy-member','http://127.0.0.1:8790/apirest.php','legacy-uncertain',NULL,'2026-01-01T00:00:00.000Z'),
    ('22222222-2222-2222-2222-222222222222','legacy-two','http://127.0.0.1:8790/apirest.php','legacy-proof',NULL,'2026-01-01T00:00:00.000Z');
`);
source.close();
const { sqlite } = await import('../db/raw.ts');
const { acknowledgeGlpiCreationResult, createGlpiTicket, glpiUncertainRequests, resolveLegacyCreation } = await import('../lib/glpi.ts');
const db = sqlite();
const api = 'http://127.0.0.1:8790/apirest.php';

test('result-less legacy rows remain blocked until explicit abandon or proof recovery', async () => {
  const before = db.prepare('SELECT acknowledged_at,legacy_state FROM glpi_creations WHERE request_id=?').get('11111111-1111-1111-1111-111111111111');
  assert.equal(before.acknowledged_at, null);
  assert.equal(before.legacy_state, 'pending');
  const pending = glpiUncertainRequests('legacy-member', api);
  assert.equal(pending.blocked, true);
  assert.equal(pending.requests.length, 0);
  assert.equal(pending.legacy?.[0]?.request_id, '11111111-1111-1111-1111-111111111111');

  await assert.rejects(
    createGlpiTicket('legacy-member', { api, web: 'http://127.0.0.1:8790', appToken: '' }, {
      request_id: '33333333-3333-3333-3333-333333333333', client_id: 'missing', title: 'Must stay blocked', description: 'No silent retry', type: 1, urgency: 3, category: 0,
    }),
    error => error.status === 409 && /historique|indécise/i.test(error.message),
  );
  assert.deepEqual(resolveLegacyCreation('legacy-member', undefined, '11111111-1111-1111-1111-111111111111', 'abandon'), { ok: true, resolution: 'abandoned' });
  assert.equal(glpiUncertainRequests('legacy-member', api).blocked, false);

  const recoveredPayload = { request_id: '22222222-2222-2222-2222-222222222222', client_id: 'legacy-client', title: 'Recovered legacy', description: 'Evidence', type: 1, urgency: 3, category: 0 };
  const hash = createHash('sha256').update(JSON.stringify([recoveredPayload.client_id, recoveredPayload.title, recoveredPayload.description, recoveredPayload.type, recoveredPayload.urgency, recoveredPayload.category])).digest('hex');
  db.prepare('UPDATE glpi_creations SET payload_hash=? WHERE request_id=?').run(hash, recoveredPayload.request_id);
  const ticket = { id: 902, title: recoveredPayload.title, status: 1, entity: 4, url: 'http://127.0.0.1:8790/front/ticket.form.php?id=902', client_id: null, client: null };
  const recovered = resolveLegacyCreation('legacy-two', undefined, recoveredPayload.request_id, 'recover', recoveredPayload, ticket);
  assert.equal(recovered.resolution, 'recovered');
  assert.equal(glpiUncertainRequests('legacy-two', api).requests[0].ticket.id, 902);
});

test('ACK is idempotent and canonical UUID aliases recover the consumed result', async () => {
  const payload = { request_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', client_id: 'alias-client', title: 'One authoritative ticket', description: 'Same canonical request', type: 1, urgency: 3, category: 0 };
  const fingerprint = createHash('sha256').update(JSON.stringify([payload.client_id, payload.title, payload.description, payload.type, payload.urgency, payload.category])).digest('hex');
  const ticket = { id: 903, title: payload.title, status: 1, entity: 4, url: 'http://127.0.0.1:8790/front/ticket.form.php?id=903', client_id: null, client: null };
  db.prepare(`INSERT INTO glpi_creations(request_id,member_id,api_url,payload_hash,payload_json,result_json,acknowledged_at,expires_at,legacy_state,created_at)
    VALUES (?,?,?,?,?,?,NULL,NULL,'active',?)`).run(payload.request_id, 'alias-member', api, fingerprint, JSON.stringify(payload), JSON.stringify(ticket), '2026-10-03T00:00:00.000Z');
  db.prepare(`INSERT INTO glpi_creation_aliases(alias_request_id,operation_request_id,member_id,api_url,payload_hash,result_json,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,NULL)`).run(payload.request_id, payload.request_id, 'alias-member', api, fingerprint, JSON.stringify(ticket), '2026-10-03T00:00:00.000Z');
  assert.equal(acknowledgeGlpiCreationResult('alias-member', api, payload.request_id, ticket.id).ok, true);
  assert.equal(acknowledgeGlpiCreationResult('alias-member', api, payload.request_id, ticket.id).ok, true);

  const aliasPayload = { ...payload, request_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' };
  db.prepare(`INSERT INTO glpi_creation_aliases(alias_request_id,operation_request_id,member_id,api_url,payload_hash,result_json,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(aliasPayload.request_id, payload.request_id, 'alias-member', api, fingerprint, JSON.stringify(ticket), '2026-10-03T00:00:00.000Z', '2026-10-04T00:00:00.000Z');
  const replay = await createGlpiTicket('alias-member', { api, web: 'http://127.0.0.1:8790', appToken: '' }, aliasPayload);
  assert.equal(replay.ticket.id, ticket.id);
  assert.equal(replay.operation.payload.request_id, payload.request_id);
  const alias = db.prepare('SELECT operation_request_id,result_json,expires_at FROM glpi_creation_aliases WHERE alias_request_id=?').get(aliasPayload.request_id);
  assert.equal(alias.operation_request_id, payload.request_id);
  assert.equal(JSON.parse(alias.result_json).id, ticket.id);
  assert.ok(alias.expires_at);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM glpi_creations WHERE member_id=?').get('alias-member').n, 1);
  await assert.rejects(
    createGlpiTicket('alias-member', { api, web: 'http://127.0.0.1:8790', appToken: '' }, { ...payload, request_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc' }),
    error => error.status === 409 && /identique|distincte/i.test(error.message),
  );
});
