import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = mkdtempSync('/dev/shm/sumatime-glpi-round11-authority-');
process.env.DATABASE_PATH = resolve(directory, 'round11.sqlite');
process.env.GLPI_WRITE_ENABLED = 'true';
const source = new DatabaseSync(process.env.DATABASE_PATH);
source.exec(readFileSync(resolve('drizzle/0000_spotty_luminals.sql'), 'utf8'));
source.exec("INSERT INTO members(id,email,name,created_at) VALUES\n" +
  "('round11-alice','round11-alice@example.test','Round 11 Alice','2026-01-01T00:00:00.000Z'),\n" +
  "('round11-bob','round11-bob@example.test','Round 11 Bob','2026-01-01T00:00:00.000Z');\n" +
  "INSERT INTO clients(id,name,active) VALUES ('round11-client','Round 11 client',1);");
source.close();

const { sqlite } = await import('../db/raw.ts');
const db = sqlite();
db.prepare('UPDATE clients SET glpi_entity_id=? WHERE id=?').run(4, 'round11-client');
const { beginGlpiDistinctCreation, createGlpiTicket, glpiUncertainRequests, setGlpiClock, saveGlpiToken } = await import('../lib/glpi.ts');
const config = { api: 'http://127.0.0.1:8811/apirest.php', web: 'http://127.0.0.1:8811', appToken: '' };
saveGlpiToken('round11-alice', config, 'round11-alice-token');

let ticketId = 9910;
const calls = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  calls.push({ path: url.pathname, body });
  if (url.pathname.endsWith('/initSession')) return new Response(JSON.stringify({ session_token: 'round11-session' }));
  if (url.pathname.endsWith('/getMyEntities')) return new Response(JSON.stringify({ myentities: [{ id: 4 }] }));
  if (url.pathname.endsWith('/changeActiveEntities')) return new Response('true');
  if (url.pathname.endsWith('/Ticket')) return new Response(JSON.stringify({ id: ++ticketId }));
  if (url.pathname.endsWith('/killSession')) return new Response('{}');
  throw new Error('Unexpected mock request ' + url);
};

const payload = (request_id, title) => ({ request_id, client_id: 'round11-client', title, description: 'Server-owned draft payload', type: 1, urgency: 3, category: 0 });
const draft = value => value + '-1111-1111-1111-111111111111';

test('renewal is generation-idempotent and a reserved draft returns its result', async () => {
  let fakeNow = Date.parse('2026-10-04T00:00:00.000Z');
  const restoreClock = setGlpiClock(() => fakeNow);
  try {
    const requestId = draft('aaaaaaaa');
    const firstPayload = payload(requestId, 'Round 11 distinct');
    const first = beginGlpiDistinctCreation('round11-alice', config, undefined, requestId, firstPayload);
    const sameLive = beginGlpiDistinctCreation('round11-alice', config, undefined, requestId, firstPayload);
    assert.equal(sameLive.intent_id, first.intent_id);
    assert.equal(sameLive.generation, first.generation);

    fakeNow = Date.parse(first.expiresAt) + 1;
    const renewed = beginGlpiDistinctCreation('round11-alice', config, undefined, requestId, firstPayload);
    const concurrentRenewal = beginGlpiDistinctCreation('round11-alice', config, undefined, requestId, firstPayload);
    assert.notEqual(renewed.intent_id, first.intent_id);
    assert.equal(concurrentRenewal.intent_id, renewed.intent_id);
    assert.equal(concurrentRenewal.generation, renewed.generation);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM glpi_creation_intents WHERE member_id=? AND api_url=? AND draft_request_id=? AND abandoned_at IS NULL AND used_at IS NULL').get('round11-alice', config.api, requestId).n, 1);
    assert.equal(db.prepare('SELECT abandoned_at FROM glpi_creation_intents WHERE intent_id=?').get(first.intent_id).abandoned_at !== null, true);

    const created = await createGlpiTicket('round11-alice', config, { ...firstPayload, distinct_intent: renewed.intent_id });
    const postsBeforeRecovery = calls.filter(call => call.path.endsWith('/Ticket')).length;
    fakeNow = Date.parse(renewed.expiresAt) + 1;
    const recovered = beginGlpiDistinctCreation('round11-alice', config, undefined, requestId, firstPayload);
    assert.equal(recovered.operation.ticket.id, created.ticket.id);
    assert.equal(recovered.operation.payload.request_id, requestId);
    assert.equal(calls.filter(call => call.path.endsWith('/Ticket')).length, postsBeforeRecovery);
  } finally {
    restoreClock();
  }
});

test('server draft listing is member/API scoped and keeps multiple drafts explicit', () => {
  const a = payload(draft('bbbbbbbb'), 'Alice draft one');
  const b = payload(draft('cccccccc'), 'Alice draft two');
  const bob = payload(draft('dddddddd'), 'Bob draft');
  beginGlpiDistinctCreation('round11-alice', config, undefined, a.request_id, a);
  beginGlpiDistinctCreation('round11-alice', config, undefined, b.request_id, b);
  beginGlpiDistinctCreation('round11-bob', config, undefined, bob.request_id, bob);
  const alice = glpiUncertainRequests('round11-alice', config.api);
  const bobDrafts = glpiUncertainRequests('round11-bob', config.api);
  assert.deepEqual(alice.distinctDrafts?.map(item => item.payload.title).sort(), ['Alice draft one', 'Alice draft two', 'Round 11 distinct']);
  assert.deepEqual(bobDrafts.distinctDrafts?.map(item => item.payload.title), ['Bob draft']);
  assert.equal(alice.distinctDrafts?.some(item => item.payload.title === 'Bob draft'), false);
});
