import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = mkdtempSync('/dev/shm/sumatime-glpi-round13-authority-');
process.env.DATABASE_PATH = resolve(directory, 'round13.sqlite');
process.env.GLPI_WRITE_ENABLED = 'true';

const source = new DatabaseSync(process.env.DATABASE_PATH);
source.exec(readFileSync(resolve('drizzle/0000_spotty_luminals.sql'), 'utf8'));
source.exec(readFileSync(resolve('drizzle/0005_provider_workspace.sql'), 'utf8'));
source.exec(`
  INSERT INTO members(id,email,name,created_at) VALUES
    ('round13-alice','round13-alice@example.test','Round 13 Alice','2026-01-01T00:00:00.000Z'),
    ('round13-bob','round13-bob@example.test','Round 13 Bob','2026-01-01T00:00:00.000Z');
  INSERT INTO clients(id,name,active,glpi_entity_id) VALUES
    ('round13-client','Round 13 client',1,4);
  CREATE TABLE glpi_creations (
    request_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, api_url TEXT NOT NULL,
    payload_hash TEXT NOT NULL, result_json TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE glpi_creation_intents (
    intent_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, api_url TEXT NOT NULL,
    scope_request_id TEXT, draft_request_id TEXT, created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL, abandoned_at TEXT, used_at TEXT,
    used_request_id TEXT, used_payload_hash TEXT, operation_request_id TEXT
  );
`);

const configA = { api: 'http://127.0.0.1:8813/apirest.php', web: 'http://127.0.0.1:8813', appToken: '' };
const configB = { api: 'http://127.0.0.1:8814/apirest.php', web: 'http://127.0.0.1:8814', appToken: '' };
const equalTimestamp = '2026-10-04T10:00:00.123Z';
const migrationDraft = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const abandonedCapability = 'f'.repeat(64);
const validCapability = 'a'.repeat(64);
source.prepare(`INSERT INTO glpi_creation_intents
  (intent_id,member_id,api_url,draft_request_id,created_at,expires_at,abandoned_at)
  VALUES (?,?,?,?,?,?,?)`).run(abandonedCapability, 'round13-alice', configA.api, migrationDraft, equalTimestamp, '2099-01-01T00:00:00.000Z', equalTimestamp);
source.prepare(`INSERT INTO glpi_creation_intents
  (intent_id,member_id,api_url,draft_request_id,created_at,expires_at)
  VALUES (?,?,?,?,?,?)`).run(validCapability, 'round13-alice', configA.api, migrationDraft, equalTimestamp, '2099-01-01T00:00:00.000Z');
source.close();

const { sqlite } = await import('../db/raw.ts');
const db = sqlite();
const { abandonGlpiDistinctCreation, acknowledgeGlpiCreationResult, beginGlpiDistinctCreation, createGlpiTicket, glpiUncertainRequests, saveGlpiToken, setGlpiClock } = await import('../lib/glpi.ts');
saveGlpiToken('round13-alice', configA, 'round13-alice-token');
saveGlpiToken('round13-bob', configB, 'round13-bob-token');

let ticketId = 117;
const calls = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  calls.push({ api: url.origin, path: url.pathname, body });
  if (url.pathname.endsWith('/initSession')) return new Response(JSON.stringify({ session_token: 'round13-session-' + url.port }));
  if (url.pathname.endsWith('/getMyEntities')) return new Response(JSON.stringify({ myentities: [{ id: 4 }] }));
  if (url.pathname.endsWith('/changeActiveEntities')) return new Response('true');
  if (url.pathname.endsWith('/Ticket')) return new Response(JSON.stringify({ id: ++ticketId }));
  if (url.pathname.endsWith('/killSession')) return new Response('{}');
  throw new Error('Unexpected mock request ' + url);
};

const payload = (request_id, title = 'Round 13 same business fields') => ({
  request_id, client_id: 'round13-client', title,
  description: 'Round 13 adversarial authority proof', type: 1, urgency: 3, category: 0,
});
const draft = value => value + '-1111-1111-1111-111111111111';
const ticketPosts = () => calls.filter(call => call.path.endsWith('/Ticket'));

test('generation-zero migration chooses the exact consumed reservation over a lexical tombstone', async () => {
  const value = payload(migrationDraft, 'Migrated exact reservation');
  const issued = beginGlpiDistinctCreation('round13-alice', configA, undefined, migrationDraft, value);
  assert.equal(issued.intent_id, validCapability, 'equal timestamps must select the active capability by state, not UUID order');
  const created = await createGlpiTicket('round13-alice', configA, { ...value, distinct_intent: issued.intent_id });
  assert.equal(created.ticket.id, 118);
  assert.equal(ticketPosts().length, 1);

  const replay = await createGlpiTicket('round13-alice', configA, value);
  assert.equal(replay.ticket.id, created.ticket.id, 'replay without capability returns the reservation-bound ticket');
  assert.equal(replay.operation.payload.request_id, migrationDraft);
  assert.equal(ticketPosts().length, 1, 'migration replay never creates a second provider ticket');
  assert.equal(db.prepare('SELECT abandoned_at FROM glpi_creation_intents WHERE intent_id=?').get(abandonedCapability).abandoned_at, equalTimestamp);
  assert.ok(db.prepare('SELECT used_at,operation_request_id FROM glpi_creation_intents WHERE intent_id=?').get(validCapability).used_at);
});

test('real tombstones stay fail-closed and member/API scopes cannot cross-authorize', async () => {
  const tombstone = payload(draft('bbbbbbbb'), 'Fail closed tombstone');
  const intent = beginGlpiDistinctCreation('round13-alice', configA, undefined, tombstone.request_id, tombstone);
  abandonGlpiDistinctCreation('round13-alice', configA.api, intent.intent_id);
  const before = ticketPosts().length;
  await assert.rejects(createGlpiTicket('round13-alice', configA, tombstone), error => error?.code === 'INTENT_ABANDONED' && error?.terminal === true);
  assert.equal(ticketPosts().length, before);

  const bobDraft = payload(draft('cccccccc'), 'Bob private draft');
  const bobIntent = beginGlpiDistinctCreation('round13-bob', configB, undefined, bobDraft.request_id, bobDraft);
  await assert.rejects(createGlpiTicket('round13-alice', configA, { ...bobDraft, distinct_intent: bobIntent.intent_id }), error => error?.status === 403);
  assert.equal(ticketPosts().length, before);
  assert.equal(glpiUncertainRequests('round13-alice', configA.api).distinctDrafts?.some(item => item.payload.title === 'Bob private draft'), false);
  assert.equal(glpiUncertainRequests('round13-bob', configB.api).distinctDrafts?.some(item => item.payload.title === 'Bob private draft'), true);
});

test('equal and distinct timestamps preserve generation authority without capability chronology', () => {
  let fakeNow = Date.parse('2026-10-04T11:00:00.000Z');
  const restoreClock = setGlpiClock(() => fakeNow);
  try {
    const requestId = draft('dddddddd');
    const value = payload(requestId, 'Distinct timestamp renewal');
    const first = beginGlpiDistinctCreation('round13-alice', configA, undefined, requestId, value);
    fakeNow = Date.parse(first.expiresAt) + 1;
    const renewed = beginGlpiDistinctCreation('round13-alice', configA, undefined, requestId, value);
    assert.equal(renewed.generation, (first.generation || 0) + 1);
    assert.notEqual(renewed.intent_id, first.intent_id);
    const listed = glpiUncertainRequests('round13-alice', configA.api).distinctDrafts?.find(item => item.draft_request_id === requestId);
    assert.equal(listed?.intent_id, renewed.intent_id);
  } finally {
    restoreClock();
  }
});

test('two consumed ACK results replay by exact UUID and never duplicate provider calls', async () => {
  const first = payload(draft('eeeeeeee'), 'ACK one');
  const second = payload(draft('ffffffff'), 'ACK two');
  const firstIntent = beginGlpiDistinctCreation('round13-alice', configA, undefined, first.request_id, first);
  const secondIntent = beginGlpiDistinctCreation('round13-alice', configA, undefined, second.request_id, second);
  const createdFirst = await createGlpiTicket('round13-alice', configA, { ...first, distinct_intent: firstIntent.intent_id });
  const createdSecond = await createGlpiTicket('round13-alice', configA, { ...second, distinct_intent: secondIntent.intent_id });
  assert.equal(ticketPosts().length, 3);
  assert.equal(acknowledgeGlpiCreationResult('round13-alice', configA.api, first.request_id, createdFirst.ticket.id).ok, true);
  assert.equal(acknowledgeGlpiCreationResult('round13-alice', configA.api, second.request_id, createdSecond.ticket.id).ok, true);
  const recoveryProjection = glpiUncertainRequests('round13-alice', configA.api, true);
  assert.equal(recoveryProjection.ack_scope, configA.api, 'ACK recovery carries the exact API scope to the cold UI');
  const recovered = recoveryProjection.recoverable || [];
  assert.deepEqual(recovered.map(item => item.payload.request_id).sort(), [first.request_id, second.request_id].sort());
  const replayFirst = await createGlpiTicket('round13-alice', configA, first);
  const replaySecond = await createGlpiTicket('round13-alice', configA, second);
  assert.equal(replayFirst.ticket.id, createdFirst.ticket.id);
  assert.equal(replaySecond.ticket.id, createdSecond.ticket.id);
  assert.equal(ticketPosts().length, 3, 'both consumed UUIDs replay without another provider POST');
  assert.equal(glpiUncertainRequests('round13-alice', configA.api).distinctDrafts?.some(item => item.payload.request_id === first.request_id), false);
  assert.equal(glpiUncertainRequests('round13-alice', configA.api).distinctDrafts?.some(item => item.payload.request_id === second.request_id), false);
});
