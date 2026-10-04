import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = mkdtempSync('/dev/shm/sumatime-glpi-round10-expiry-');
process.env.DATABASE_PATH = resolve(directory, 'round10.sqlite');
process.env.GLPI_WRITE_ENABLED = 'true';
const source = new DatabaseSync(process.env.DATABASE_PATH);
source.exec(readFileSync(resolve('drizzle/0000_spotty_luminals.sql'), 'utf8'));
source.exec(`INSERT INTO members(id,email,name,created_at) VALUES ('round10-member','round10@example.test','Round 10','2026-01-01T00:00:00.000Z');
  INSERT INTO clients(id,name,active) VALUES ('round10-client','Round 10 client',1);`);
source.close();

const { sqlite } = await import('../db/raw.ts');
const db = sqlite();
db.prepare('UPDATE clients SET glpi_entity_id=? WHERE id=?').run(4, 'round10-client');
const { beginGlpiDistinctCreation, createGlpiTicket, GLPI_DISTINCT_INTENT_TTL_MS, saveGlpiToken, setGlpiClock } = await import('../lib/glpi.ts');
const config = { api: 'http://127.0.0.1:8810/apirest.php', web: 'http://127.0.0.1:8810', appToken: '' };
saveGlpiToken('round10-member', config, 'round10-token');

let ticketId = 9800;
const calls = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  calls.push({ path: url.pathname, body });
  if (url.pathname.endsWith('/initSession')) return new Response(JSON.stringify({ session_token: 'round10-session' }));
  if (url.pathname.endsWith('/getMyEntities')) return new Response(JSON.stringify({ myentities: [{ id: 4 }] }));
  if (url.pathname.endsWith('/changeActiveEntities')) return new Response('true');
  if (url.pathname.endsWith('/Ticket')) return new Response(JSON.stringify({ id: ++ticketId }));
  if (url.pathname.endsWith('/killSession')) return new Response('{}');
  throw new Error(`Unexpected mock request ${url}`);
};

const ticketPosts = () => calls.filter(call => call.path.endsWith('/Ticket'));
const payload = request_id => ({ request_id, client_id: 'round10-client', title: 'Same fingerprint', description: 'Expiry must not alias this result', type: 1, urgency: 3, category: 0 });
const draft = value => `${value}-1111-1111-1111-111111111111`;

test('server-bound distinct drafts fail closed at TTL-1, exact expiry and TTL+1, then renew once', { concurrency: false }, async () => {
  let fakeNow = Date.parse('2026-10-04T00:00:00.000Z');
  const restoreClock = setGlpiClock(() => fakeNow);
  try {
    const first = await createGlpiTicket('round10-member', config, payload('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'));
    assert.equal(first.ticket.id, 9801);
    assert.equal(ticketPosts().length, 1);

    // Just before expiry is accepted. The capability is bound to the new
    // UUID before any request can enter the fingerprint alias path.
    const beforeExpiryDraft = draft('bbbbbbbb');
    const beforeExpiry = beginGlpiDistinctCreation('round10-member', config, first.operation.payload.request_id, beforeExpiryDraft);
    fakeNow = Date.parse(beforeExpiry.expiresAt) - 1;
    const second = await createGlpiTicket('round10-member', config, { ...payload(beforeExpiryDraft), distinct_intent: beforeExpiry.intent_id });
    assert.equal(second.ticket.id, 9802);
    assert.equal(ticketPosts().length, 2);

    const boundaries = [
      { name: 'exact', draftId: draft('cccccccc'), delta: 0 },
      { name: 'plus one', draftId: draft('dddddddd'), delta: 1 },
    ];
    for (const boundary of boundaries) {
      fakeNow = Date.parse('2026-10-04T01:00:00.000Z');
      const intent = beginGlpiDistinctCreation('round10-member', config, first.operation.payload.request_id, boundary.draftId);
      fakeNow = Date.parse(intent.expiresAt) + boundary.delta;
      await assert.rejects(
        createGlpiTicket('round10-member', config, { ...payload(boundary.draftId), distinct_intent: intent.intent_id }),
        error => error.code === 'INTENT_EXPIRED' && error.status === 409,
        `${boundary.name} boundary must reject the expired capability explicitly`,
      );
      assert.equal(ticketPosts().length, 2, `${boundary.name} expiry cannot contact GLPI`);
      await assert.rejects(
        createGlpiTicket('round10-member', config, payload(boundary.draftId)),
        error => error.code === 'INTENT_EXPIRED' && error.status === 409,
        `${boundary.name} missing capability must not become an ordinary request`,
      );
      assert.equal(ticketPosts().length, 2);
    }

    // A live marker with a missing token is also fail-closed, proving that a
    // storage/auth loss cannot silently consume the older ticket.
    const missingTokenDraft = draft('eeeeeeee');
    fakeNow = Date.parse('2026-10-04T02:00:00.000Z');
    const missingToken = beginGlpiDistinctCreation('round10-member', config, first.operation.payload.request_id, missingTokenDraft);
    await assert.rejects(
      createGlpiTicket('round10-member', config, payload(missingTokenDraft)),
      error => error.code === 'INTENT_REQUIRED' && error.status === 409,
    );
    assert.equal(ticketPosts().length, 2);

    // Renewal keeps the same draft UUID and creates exactly one new provider
    // ticket; it can never replay either earlier result.
    fakeNow = Date.parse(missingToken.expiresAt) + 1;
    const renewed = beginGlpiDistinctCreation('round10-member', config, first.operation.payload.request_id, missingTokenDraft);
    assert.ok(Date.parse(renewed.expiresAt) > fakeNow);
    const third = await createGlpiTicket('round10-member', config, { ...payload(missingTokenDraft), distinct_intent: renewed.intent_id });
    assert.equal(third.ticket.id, 9803);
    assert.notEqual(third.ticket.id, first.ticket.id);
    assert.notEqual(third.ticket.id, second.ticket.id);
    assert.equal(third.operation.payload.request_id, missingTokenDraft);
    assert.equal(ticketPosts().length, 3, 'renewal permits one and only one new provider POST');
    const marker = db.prepare('SELECT draft_request_id,used_request_id,operation_request_id FROM glpi_creation_intents WHERE intent_id=?').get(renewed.intent_id);
    assert.equal(marker.draft_request_id, missingTokenDraft);
    assert.equal(marker.used_request_id, missingTokenDraft);
    assert.equal(marker.operation_request_id, missingTokenDraft);
    assert.equal(GLPI_DISTINCT_INTENT_TTL_MS, 10 * 60 * 1000);
  } finally {
    restoreClock();
  }
});
