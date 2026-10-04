import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = mkdtempSync('/dev/shm/sumatime-glpi-round6-contract-');
process.env.DATABASE_PATH = resolve(directory, 'round6.sqlite');
process.env.GLPI_WRITE_ENABLED = 'true';
const source = new DatabaseSync(process.env.DATABASE_PATH);
source.exec(readFileSync(resolve('drizzle/0000_spotty_luminals.sql'), 'utf8'));
source.exec(`INSERT INTO members(id,email,name,created_at) VALUES ('round6-member','round6@example.test','Round 6','2026-01-01T00:00:00.000Z');
  INSERT INTO clients(id,name,active) VALUES ('round6-client','Round 6 client',1);`);
source.close();

const { sqlite } = await import('../db/raw.ts');
const db = sqlite();
db.prepare('UPDATE clients SET glpi_entity_id=? WHERE id=?').run(4, 'round6-client');
const { acknowledgeGlpiCreationResult, beginGlpiDistinctCreation, createGlpiTicket, GLPI_CREATION_RESULT_TTL_MS } = await import('../lib/glpi.ts');
const config = { api: 'http://127.0.0.1:8796/apirest.php', web: 'http://127.0.0.1:8796', appToken: '' };
const calls = [];
await (await import('../lib/glpi.ts')).saveGlpiToken('round6-member', config, 'round6-token');

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  calls.push({ path: url.pathname, body });
  if (url.pathname.endsWith('/initSession')) return new Response(JSON.stringify({ session_token: 'round6-session' }));
  if (url.pathname.endsWith('/getMyEntities')) return new Response(JSON.stringify({ myentities: [{ id: 4 }] }));
  if (url.pathname.endsWith('/changeActiveEntities')) return new Response('true');
  if (url.pathname.endsWith('/Ticket')) {
    const id = 9600 + calls.filter(call => call.path.endsWith('/Ticket')).length;
    return new Response(JSON.stringify({ id }));
  }
  if (url.pathname.endsWith('/killSession')) return new Response('{}');
  throw new Error(`Unexpected mock request ${url}`);
};

const ticketPosts = () => calls.filter(call => call.path.endsWith('/Ticket'));
const payload = request_id => ({ request_id, client_id: 'round6-client', title: 'Daily maintenance', description: 'Same business payload', type: 1, urgency: 3, category: 0 });
const fingerprint = value => createHash('sha256').update(JSON.stringify([value.client_id, value.title, value.description, value.type, value.urgency, value.category])).digest('hex');

test('round 6 intent, permanent tombstone, stale alias, crash replay and exact POST/ACK contract', { concurrency: false }, async () => {
  const first = payload('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  const firstResult = await createGlpiTicket('round6-member', config, first);
  assert.equal(firstResult.ticket.id, 9601);
  assert.equal(ticketPosts().length, 1);

  await assert.rejects(
    createGlpiTicket('round6-member', config, payload('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb')),
    error => error.status === 409 && /identique|distincte/i.test(error.message),
    'a new client UUID cannot bypass a terminal fingerprint without an explicit intent',
  );
  assert.equal(ticketPosts().length, 1);

  const intent = beginGlpiDistinctCreation('round6-member', config, first.request_id);
  assert.match(intent.intent_id, /^[a-f0-9]{64}$/);
  assert.ok(Date.parse(intent.expiresAt) > Date.now());
  const expiredIntent = beginGlpiDistinctCreation('round6-member', config, first.request_id);
  db.prepare('UPDATE glpi_creation_intents SET expires_at=? WHERE intent_id=?').run('2000-01-01T00:00:00.000Z', expiredIntent.intent_id);
  await assert.rejects(
    createGlpiTicket('round6-member', config, { ...payload('99999999-9999-9999-9999-999999999999'), distinct_intent: expiredIntent.intent_id }),
    error => error.status === 409 && /expir/i.test(error.message),
    'an accelerated-expired server intent cannot authorize a new provider POST',
  );
  assert.equal(ticketPosts().length, 1);
  const second = payload('cccccccc-cccc-cccc-cccc-cccccccccccc');
  const secondResult = await createGlpiTicket('round6-member', config, { ...second, distinct_intent: intent.intent_id });
  assert.equal(secondResult.ticket.id, 9602);
  assert.equal(ticketPosts().length, 2, 'the server-authorized distinct request creates exactly one new provider ticket');
  const intentRow = db.prepare('SELECT used_at,used_request_id,operation_request_id FROM glpi_creation_intents WHERE intent_id=?').get(intent.intent_id);
  assert.equal(intentRow.used_request_id, second.request_id);
  assert.equal(intentRow.operation_request_id, second.request_id);
  await assert.rejects(
    createGlpiTicket('round6-member', config, { ...payload('dddddddd-dddd-dddd-dddd-dddddddddddd'), distinct_intent: intent.intent_id }),
    error => error.status === 409 && /déjà été consommée/i.test(error.message),
  );
  const retry = await createGlpiTicket('round6-member', config, { ...second, distinct_intent: intent.intent_id });
  assert.equal(retry.ticket.id, 9602);
  assert.equal(ticketPosts().length, 2, 'a response retry with the same UUID is idempotent even when it repeats the intent token');

  const firstHash = fingerprint(first);
  db.prepare(`INSERT INTO glpi_creation_aliases(alias_request_id,operation_request_id,member_id,api_url,payload_hash,result_json,created_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?)`).run('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', first.request_id, 'round6-member', config.api, firstHash,
      JSON.stringify(firstResult.ticket), firstResult.operation.createdAt, new Date(Date.now() + GLPI_CREATION_RESULT_TTL_MS).toISOString());
  assert.equal(acknowledgeGlpiCreationResult('round6-member', config.api, first.request_id, firstResult.ticket.id).ok, true);
  db.prepare('UPDATE glpi_creations SET expires_at=? WHERE request_id=?').run('2000-01-01T00:00:00.000Z', first.request_id);
  db.prepare('UPDATE glpi_creation_aliases SET expires_at=? WHERE operation_request_id=?').run('2000-01-01T00:00:00.000Z', first.request_id);
  const staleUuid = await createGlpiTicket('round6-member', config, first);
  const staleAlias = await createGlpiTicket('round6-member', config, { ...first, request_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' });
  assert.equal(staleUuid.ticket.id, firstResult.ticket.id);
  assert.equal(staleAlias.ticket.id, firstResult.ticket.id);
  assert.equal(ticketPosts().length, 2, 'expired UUID and alias tombstones replay terminal state without a provider POST');
  assert.equal(acknowledgeGlpiCreationResult('round6-member', config.api, 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', firstResult.ticket.id).ok, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM glpi_creations').get().n, 2, 'cleanup retains creation identities permanently');

  const crash = payload('ffffffff-ffff-ffff-ffff-ffffffffffff');
  const crashHash = fingerprint(crash);
  const crashCreated = '2026-10-01T00:00:00.000Z';
  db.prepare(`INSERT INTO glpi_creations(request_id,member_id,api_url,payload_hash,payload_json,result_json,acknowledged_at,expires_at,legacy_state,state,terminal_error,distinct_intent_id,created_at)
    VALUES (?,?,?,?,?,NULL,NULL,NULL,'active','active',NULL,NULL,?)`).run(crash.request_id, 'round6-member', config.api, crashHash, JSON.stringify(crash), crashCreated);
  db.prepare(`INSERT INTO glpi_creation_aliases(alias_request_id,operation_request_id,member_id,api_url,payload_hash,result_json,created_at,expires_at)
    VALUES (?,?,?,?,?,NULL,?,NULL)`).run(crash.request_id, crash.request_id, 'round6-member', config.api, crashHash, crashCreated);
  await assert.rejects(createGlpiTicket('round6-member', config, crash), error => error.status === 409 && error.constructor.name === 'GlpiCreationUncertain');
  assert.equal(ticketPosts().length, 2, 'a crash-stale reservation cannot send a second provider POST');
  const crashTicket = { id: 9699, title: crash.title, status: 1, entity: 4, url: config.web + '/front/ticket.form.php?id=9699', client_id: 'round6-client', client: 'Round 6 client' };
  db.prepare("UPDATE glpi_creations SET result_json=?,state='completed',legacy_state='completed' WHERE request_id=?").run(JSON.stringify(crashTicket), crash.request_id);
  db.prepare('UPDATE glpi_creation_aliases SET result_json=? WHERE operation_request_id=?').run(JSON.stringify(crashTicket), crash.request_id);
  const crashReplay = await createGlpiTicket('round6-member', config, crash);
  assert.equal(crashReplay.ticket.id, 9699);
  assert.equal(ticketPosts().length, 2);
});
