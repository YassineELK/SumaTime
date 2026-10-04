import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Start from the pre-generation schema so this fixture exercises the same
// migration path as an older Round 10 database. All migrated rows receive
// generation=0; their random capability IDs are intentionally inserted in the
// opposite lexical order to prove they are not a chronology.
const directory = mkdtempSync('/dev/shm/sumatime-glpi-round14-authority-');
process.env.DATABASE_PATH = resolve(directory, 'round14.sqlite');
process.env.GLPI_WRITE_ENABLED = 'true';

const source = new DatabaseSync(process.env.DATABASE_PATH);
source.exec(readFileSync(resolve('drizzle/0000_spotty_luminals.sql'), 'utf8'));
source.exec(readFileSync(resolve('drizzle/0005_provider_workspace.sql'), 'utf8'));
source.exec(`
  INSERT INTO members(id,email,name,created_at) VALUES
    ('round14-alice','round14-alice@example.test','Round 14 Alice','2026-01-01T00:00:00.000Z'),
    ('round14-bob','round14-bob@example.test','Round 14 Bob','2026-01-01T00:00:00.000Z');
  INSERT INTO clients(id,name,active,glpi_entity_id) VALUES
    ('round14-client','Round 14 client',1,4);
  CREATE TABLE glpi_creation_intents (
    intent_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, api_url TEXT NOT NULL,
    scope_request_id TEXT, draft_request_id TEXT, created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL, abandoned_at TEXT, used_at TEXT,
    used_request_id TEXT, used_payload_hash TEXT, operation_request_id TEXT
  );
`);

const configA = { api: 'http://127.0.0.1:8816/apirest.php', web: 'http://127.0.0.1:8816', appToken: '' };
const configB = { api: 'http://127.0.0.1:8817/apirest.php', web: 'http://127.0.0.1:8817', appToken: '' };
const expires = '2099-01-01T00:00:00.000Z';
const sameTimestamp = '2026-10-04T10:00:00.123Z';
const laterTimestamp = '2026-10-04T10:00:01.123Z';
const uuid = prefix => `${prefix}-1111-1111-1111-111111111111`;
const blockedEqual = uuid('aaaaaaaa');
const blockedDistinct = uuid('bbbbbbbb');
const mixed = uuid('cccccccc');
const capability = value => value.repeat(64);

// Two abandoned rows for each blocked UUID are genuine migration candidates:
// no current generation column exists yet, so HEAD's db/raw.ts migration adds
// it and leaves both rows at generation zero.
source.prepare(`INSERT INTO glpi_creation_intents
  (intent_id,member_id,api_url,draft_request_id,created_at,expires_at,abandoned_at)
  VALUES (?,?,?,?,?,?,?)`).run(capability('f'), 'round14-alice', configA.api, blockedEqual, sameTimestamp, expires, sameTimestamp);
source.prepare(`INSERT INTO glpi_creation_intents
  (intent_id,member_id,api_url,draft_request_id,created_at,expires_at)
  VALUES (?,?,?,?,?,?)`).run(capability('a'), 'round14-alice', configA.api, blockedEqual, sameTimestamp, expires);
source.prepare(`INSERT INTO glpi_creation_intents
  (intent_id,member_id,api_url,draft_request_id,created_at,expires_at,abandoned_at)
  VALUES (?,?,?,?,?,?,?)`).run(capability('e'), 'round14-alice', configA.api, blockedDistinct, sameTimestamp, expires, sameTimestamp);
source.prepare(`INSERT INTO glpi_creation_intents
  (intent_id,member_id,api_url,draft_request_id,created_at,expires_at)
  VALUES (?,?,?,?,?,?)`).run(capability('0'), 'round14-alice', configA.api, blockedDistinct, laterTimestamp, expires);
// A valid active row beside an old tombstone must retain authority. It uses
// the same generation-zero migration boundary but is not a tombstone.
source.prepare(`INSERT INTO glpi_creation_intents
  (intent_id,member_id,api_url,draft_request_id,created_at,expires_at,abandoned_at)
  VALUES (?,?,?,?,?,?,?)`).run(capability('d'), 'round14-alice', configA.api, mixed, sameTimestamp, expires, sameTimestamp);
source.prepare(`INSERT INTO glpi_creation_intents
  (intent_id,member_id,api_url,draft_request_id,created_at,expires_at)
  VALUES (?,?,?,?,?,?)`).run(capability('1'), 'round14-alice', configA.api, mixed, laterTimestamp, expires);
source.close();

const { sqlite } = await import('../db/raw.ts');
const db = sqlite();
const { abandonGlpiDistinctCreation, beginGlpiDistinctCreation, createGlpiTicket, glpiUncertainRequests, saveGlpiToken, setGlpiClock } = await import('../lib/glpi.ts');
saveGlpiToken('round14-alice', configA, 'round14-alice-token');
saveGlpiToken('round14-bob', configB, 'round14-bob-token');

assert.ok(db.prepare('SELECT generation FROM glpi_creation_intents LIMIT 1').get(), 'the pre-generation fixture was migrated');
const payload = (request_id, title) => ({
  request_id,
  client_id: 'round14-client',
  title,
  description: 'Round 14 migration authority proof',
  type: 1,
  urgency: 3,
  category: 0,
});

// Reproduce the real Round10 → HEAD lifecycle: the first old row is already
// abandoned by a renewal, the replacement row is attached to the canonical
// payload after migration, then that replacement is explicitly abandoned.
// This leaves one payload-bearing tombstone beside one payload-less tombstone,
// which is the historical shape that used to poison the projection.
const restoreClock = setGlpiClock(() => Date.parse(laterTimestamp) + 1000);
for (const [requestId, firstId, secondId] of [
  [blockedEqual, capability('f'), capability('a')],
  [blockedDistinct, capability('e'), capability('0')],
]) {
  const attached = beginGlpiDistinctCreation('round14-alice', configA, undefined, requestId, payload(requestId, `Historical ${requestId.slice(0, 8)}`));
  assert.equal(attached.intent_id, secondId);
  assert.equal(attached.generation, 0);
  assert.ok(db.prepare('SELECT abandoned_at FROM glpi_creation_intents WHERE intent_id=?').get(firstId).abandoned_at);
  assert.equal(abandonGlpiDistinctCreation('round14-alice', configA.api, secondId).ok, true);
}
restoreClock();

let ticketId = 14_000;
const calls = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  calls.push({ api: url.origin, path: url.pathname, body });
  if (url.pathname.endsWith('/initSession')) return new Response(JSON.stringify({ session_token: `round14-session-${url.port}` }));
  if (url.pathname.endsWith('/getMyEntities')) return new Response(JSON.stringify({ myentities: [{ id: 4 }] }));
  if (url.pathname.endsWith('/changeActiveEntities')) return new Response('true');
  if (url.pathname.endsWith('/Ticket')) return new Response(JSON.stringify({ id: ++ticketId }));
  if (url.pathname.endsWith('/killSession')) return new Response('{}');
  throw new Error(`Unexpected mock request ${url}`);
};
const ticketPosts = () => calls.filter(call => call.path.endsWith('/Ticket'));

test('migration leaves multiple generation-zero tombstones permanent but projection skips them', async () => {
  const columns = db.prepare('PRAGMA table_info(glpi_creation_intents)').all().map(row => row.name);
  assert.ok(columns.includes('generation'));
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM glpi_creation_intents
    WHERE member_id=? AND api_url=? AND draft_request_id=? AND generation=0 AND abandoned_at IS NOT NULL`)
    .get('round14-alice', configA.api, blockedEqual).count, 2);

  const valid = payload(uuid('dddddddd'), 'Independent valid draft');
  const intent = beginGlpiDistinctCreation('round14-alice', configA, undefined, valid.request_id, valid);
  const created = await createGlpiTicket('round14-alice', configA, { ...valid, distinct_intent: intent.intent_id });
  assert.equal(created.ticket.id, 14_001);
  assert.equal(ticketPosts().length, 1);

  const projection = glpiUncertainRequests('round14-alice', configA.api, true);
  assert.equal(projection.blocked, false, 'inactive tombstones cannot poison the member/API projection');
  assert.equal(projection.distinctDrafts?.some(item => item.draft_request_id === blockedEqual), false);
  assert.equal(projection.distinctDrafts?.some(item => item.draft_request_id === blockedDistinct), false);
  assert.equal(projection.distinctDrafts?.some(item => item.draft_request_id === valid.request_id), true);
  assert.equal(projection.requests.some(item => item.payload.request_id === valid.request_id), true);
});

test('abandoned UUIDs remain fail-closed while an exact valid reservation keeps authority', async () => {
  const before = ticketPosts().length;
  for (const requestId of [blockedEqual, blockedDistinct]) {
    const value = payload(requestId, `Abandoned ${requestId.slice(0, 8)}`);
    assert.throws(
      () => beginGlpiDistinctCreation('round14-alice', configA, undefined, requestId, value),
      error => error?.code === 'INTENT_ABANDONED' && error?.terminal === true,
    );
    await assert.rejects(
      () => createGlpiTicket('round14-alice', configA, value),
      error => error?.code === 'INTENT_ABANDONED' && error?.terminal === true,
    );
  }
  assert.equal(ticketPosts().length, before, 'renewal/replay of an abandoned UUID never reaches the provider');

  const mixedValue = payload(mixed, 'Mixed tombstone and valid reservation');
  const mixedIntent = beginGlpiDistinctCreation('round14-alice', configA, undefined, mixed, mixedValue);
  assert.equal(mixedIntent.intent_id, capability('1'), 'the live exact reservation outranks an abandoned tombstone');
  const mixedResult = await createGlpiTicket('round14-alice', configA, { ...mixedValue, distinct_intent: mixedIntent.intent_id });
  assert.equal(mixedResult.ticket.id, 14_002);
  assert.equal(ticketPosts().length, before + 1);
});

test('member and API scopes remain independent of migrated tombstones', () => {
  const bob = payload(uuid('eeeeeeee'), 'Bob independent draft');
  const bobIntent = beginGlpiDistinctCreation('round14-bob', configB, undefined, bob.request_id, bob);
  assert.equal(bobIntent.generation, 0);
  const aliceOtherApi = glpiUncertainRequests('round14-alice', configB.api, true);
  assert.equal(!!aliceOtherApi.distinctDrafts?.some(item => item.draft_request_id === blockedEqual), false);
  const bobProjection = glpiUncertainRequests('round14-bob', configB.api, true);
  assert.equal(bobProjection.blocked, false);
  assert.equal(!!bobProjection.distinctDrafts?.some(item => item.draft_request_id === bob.request_id), true);
});
