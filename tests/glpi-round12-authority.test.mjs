import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = mkdtempSync('/dev/shm/sumatime-glpi-round12-authority-');
process.env.DATABASE_PATH = resolve(directory, 'round12.sqlite');
process.env.GLPI_WRITE_ENABLED = 'true';
const source = new DatabaseSync(process.env.DATABASE_PATH);
source.exec(readFileSync(resolve('drizzle/0000_spotty_luminals.sql'), 'utf8'));
source.exec(readFileSync(resolve('drizzle/0005_provider_workspace.sql'), 'utf8'));
source.exec(`INSERT INTO members(id,email,name,created_at) VALUES ('round12-member','round12@example.test','Round 12','2026-01-01T00:00:00.000Z');
  INSERT INTO clients(id,name,active,glpi_entity_id) VALUES ('round12-client','Round 12 client',1,4);`);
source.close();

const { sqlite } = await import('../db/raw.ts');
const db = sqlite();
const { abandonGlpiDistinctCreation, acknowledgeGlpiCreationResult, beginGlpiDistinctCreation, createGlpiTicket, glpiUncertainRequests, saveGlpiToken } = await import('../lib/glpi.ts');
const config = { api: 'http://127.0.0.1:8812/apirest.php', web: 'http://127.0.0.1:8812', appToken: '' };
saveGlpiToken('round12-member', config, 'round12-token');

let ticketId = 12_000;
let ticketMode = 'uncertain';
let ticketPosts = 0;
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if (url.pathname.endsWith('/initSession')) return new Response(JSON.stringify({ session_token: 'round12-session' }));
  if (url.pathname.endsWith('/getMyEntities')) return new Response(JSON.stringify({ myentities: [{ id: 4 }] }));
  if (url.pathname.endsWith('/changeActiveEntities')) return new Response('true');
  if (url.pathname.endsWith('/Ticket')) {
    ticketPosts += 1;
    if (ticketMode === 'uncertain') throw new Error('simulated response loss after provider acceptance');
    if (ticketMode === 'reject') return new Response(JSON.stringify({ error: 'ERROR_GLPI_ADD' }), { status: 422 });
    return new Response(JSON.stringify({ id: ++ticketId }));
  }
  if (url.pathname.endsWith('/killSession')) return new Response('{}');
  throw new Error('Unexpected mock request ' + url);
};

const payload = (request_id, title) => ({ request_id, client_id: 'round12-client', title, description: 'Round 12 authoritative identity', type: 1, urgency: 3, category: 0 });
const request = prefix => `${prefix}-1111-1111-1111-111111111111`;

test('abandoned distinct UUID is a permanent scoped tombstone and cannot alias an older uncertain operation', async () => {
  const oldPayload = payload(request('aaaaaaaa'), 'Round 12 same fingerprint');
  await assert.rejects(createGlpiTicket('round12-member', config, oldPayload), error => error?.code === 'CREATION_UNCERTAIN');
  const abandonedPayload = payload(request('bbbbbbbb'), oldPayload.title);
  const intent = beginGlpiDistinctCreation('round12-member', config, undefined, abandonedPayload.request_id, abandonedPayload);
  abandonGlpiDistinctCreation('round12-member', config.api, intent.intent_id);
  const before = ticketPosts;
  await assert.rejects(createGlpiTicket('round12-member', config, abandonedPayload), error => error?.code === 'INTENT_ABANDONED' && error?.terminal === true);
  assert.equal(ticketPosts, before, 'abandoned UUID replay must not reach the provider');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM glpi_creation_aliases WHERE alias_request_id=?').get(abandonedPayload.request_id).n, 0);
});

test('acknowledged distinct result is absent from distinct drafts and stays recoverable only in the ACK projection', async () => {
  ticketMode = 'success';
  const value = payload(request('cccccccc'), 'Round 12 acknowledged');
  const intent = beginGlpiDistinctCreation('round12-member', config, undefined, value.request_id, value);
  const created = await createGlpiTicket('round12-member', config, { ...value, distinct_intent: intent.intent_id });
  assert.equal(acknowledgeGlpiCreationResult('round12-member', config.api, value.request_id, created.ticket.id).ok, true);
  const normal = glpiUncertainRequests('round12-member', config.api, false);
  const recovery = glpiUncertainRequests('round12-member', config.api, true);
  assert.equal((normal.distinctDrafts || []).some(item => item.draft_request_id === value.request_id), false);
  assert.equal((recovery.distinctDrafts || []).some(item => item.draft_request_id === value.request_id), false);
  assert.equal((recovery.recoverable || []).some(item => item.payload.request_id === value.request_id), true);
});

test('certain distinct rejection remains rejected across cold server projections', async () => {
  ticketMode = 'reject';
  const value = payload(request('dddddddd'), 'REJECT-CREATE');
  const intent = beginGlpiDistinctCreation('round12-member', config, undefined, value.request_id, value);
  await assert.rejects(createGlpiTicket('round12-member', config, { ...value, distinct_intent: intent.intent_id }), error => error?.code === 'CREATION_REJECTED' && error?.terminal === true);
  const row = db.prepare('SELECT state,terminal_error FROM glpi_creations WHERE request_id=?').get(value.request_id);
  assert.equal(row.state, 'rejected');
  const resumed = beginGlpiDistinctCreation('round12-member', config, undefined, value.request_id, value);
  assert.equal(resumed.state, 'rejected');
  assert.equal(resumed.operation?.ticket, undefined);
  const listed = glpiUncertainRequests('round12-member', config.api, false);
  const draft = listed.distinctDrafts?.find(item => item.draft_request_id === value.request_id);
  assert.equal(draft?.state, 'rejected');
  assert.equal(draft?.operation?.ticket, undefined);
});
