import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = mkdtempSync('/tmp/sumatime-entity-scope-');
process.env.DATABASE_PATH = resolve(directory, 'scope.sqlite');
process.env.GLPI_API_URL = 'http://127.0.0.1:8799/apirest.php';
const source = new DatabaseSync(process.env.DATABASE_PATH);
source.exec(readFileSync('drizzle/0000_spotty_luminals.sql', 'utf8'));
source.exec(`INSERT INTO members(id,email,name,created_at) VALUES
  ('alice','alice@scope.test','Alice','2026-01-01'), ('bob','bob@scope.test','Bob','2026-01-01');
  INSERT INTO clients(id,name,active) VALUES ('root','Root',1),('salarypay','Salarypay',1),('other','Other',1);`);
source.close();
const { sqlite } = await import('../db/raw.ts');
const db = sqlite();
for (const [id, entity] of [['root', 0], ['salarypay', 2], ['other', 9]]) db.prepare('UPDATE clients SET glpi_entity_id=? WHERE id=?').run(entity, id);
const { glpiTickets, saveGlpiToken, validateGlpiTicketSelection } = await import('../lib/glpi.ts');
const config = { api: process.env.GLPI_API_URL, web: 'http://127.0.0.1:8799', appToken: '' };
saveGlpiToken('alice', config, 'alice-scope-token');
saveGlpiToken('bob', config, 'bob-scope-token');
const tickets = [
  { id: 1140, name: 'Root ticket', status: 2, entities_id: 0 },
  { id: 1141, name: 'Service Login and rdp fails', status: 5, entities_id: 2 },
  { id: 1142, name: 'Closed Salarypay ticket', status: 6, entities_id: 2 },
  { id: 1143, name: 'Other client ticket', status: 2, entities_id: 9 },
];
const sessions = new Map(), calls = [];
let sequence = 0, scopeFailure;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input)), path = url.pathname.replace('/apirest.php/', '');
  const payload = init.body ? JSON.parse(init.body) : undefined;
  calls.push({ path, method: init.method || 'GET', payload });
  const reply = (data, status = 200) => new Response(JSON.stringify(data), { status });
  if (path === 'initSession') {
    const alice = init.headers.Authorization === 'user_token alice-scope-token';
    const session = `session-${++sequence}`;
    // Reproduce a nonrecursive root default despite an additional Salarypay grant.
    sessions.set(session, { permitted: alice ? [0, 2] : [9], active: alice ? [0] : [9] });
    return reply({ session_token: session });
  }
  const key = init.headers['Session-Token'], state = sessions.get(key);
  assert(state, 'a personal API session is required');
  if (path === 'killSession') { sessions.delete(key); return reply(true); }
  if (path === 'changeActiveEntities') {
    assert.deepEqual(payload, { is_recursive: true }, 'omit entities_id: an explicit all is converted to root by GLPI');
    if (scopeFailure === 'http') return reply(['ERROR'], 503);
    if (scopeFailure !== undefined) return reply(scopeFailure);
    state.active = [...state.permitted]; return reply(true);
  }
  if (path === 'listSearchOptions/Ticket') return reply({ 2: { table: 'glpi_tickets', field: 'id' }, 1: { table: 'glpi_tickets', field: 'name' }, 12: { table: 'glpi_tickets', field: 'status' } });
  if (path === 'search/Ticket') {
    let found = tickets.filter(ticket => state.active.includes(ticket.entities_id));
    for (let i = 0; i < 2; i++) {
      const field = url.searchParams.get(`criteria[${i}][field]`), type = url.searchParams.get(`criteria[${i}][searchtype]`), value = url.searchParams.get(`criteria[${i}][value]`);
      if (field === '2') found = found.filter(ticket => String(ticket.id).startsWith(value.replace(/^\^/, '')));
      if (field === '12') { assert.equal(type, 'equals'); assert.equal(value, 'notclosed'); found = found.filter(ticket => ticket.status !== 6); }
    }
    found.sort((a, b) => b.id - a.id);
    const offset = Number(url.searchParams.get('range').split('-')[0]);
    return reply({ totalcount: found.length, data: found.slice(offset, offset + 10).map(ticket => ({ 'Ticket.id': ticket.id })) });
  }
  if (path.startsWith('Ticket/')) {
    const ticket = tickets.find(ticket => ticket.id === Number(path.split('/')[1]));
    return ticket && state.active.includes(ticket.entities_id) ? reply(ticket) : reply(['FORBIDDEN'], 403);
  }
  throw new Error(`Unexpected provider operation ${path}`);
};
function clean() {
  assert.equal(sessions.size, 0, 'every transient API session is closed');
  assert(calls.every(call => call.method === 'GET' || call.path === 'changeActiveEntities'), 'no provider data write or profile escalation');
}

test('root and child tickets are searched together using only the personal profile grants', async () => {
  const result = await glpiTickets('alice', config, '', 0, true);
  assert.deepEqual(result.tickets.map(ticket => ticket.id), [1141, 1140]);
  assert.equal(result.total, 2);
  assert.equal(result.tickets[0].client_id, 'salarypay');
  assert.equal(result.tickets[1].client_id, 'root', 'entity zero remains a valid association');
  assert.equal((await glpiTickets('alice', config, '1143', 0, false)).total, 0);
  const bob = await glpiTickets('bob', config, '', 0, false);
  assert.deepEqual(bob.tickets.map(ticket => ticket.id), [1143]);
  clean();
});
test('resolved tickets remain selectable by default and include closed adds only closed tickets', async () => {
  assert.equal((await glpiTickets('alice', config, '1141', 0, true)).tickets[0].status, 5);
  assert.equal((await glpiTickets('alice', config, '1142', 0, true)).total, 0);
  assert.equal((await glpiTickets('alice', config, '1142', 0, false)).tickets[0].status, 6);
  clean();
});
test('saving a selected child ticket activates the same permitted scope and retains client and access checks', async () => {
  const result = await validateGlpiTicketSelection('alice', 1141, 'salarypay');
  assert.equal(result.glpi_ticket_id, 1141); assert.equal(result.entity, 2);
  await assert.rejects(validateGlpiTicketSelection('alice', 1141, 'other'), error => error.code === 'TICKET_CLIENT_MISMATCH');
  await assert.rejects(validateGlpiTicketSelection('alice', 1143, 'other'), error => error.code === 'TICKET_SELECTION_REQUIRED');
  db.prepare('UPDATE clients SET active=0 WHERE id=?').run('salarypay');
  await assert.rejects(validateGlpiTicketSelection('alice', 1141, 'salarypay'), error => error.code === 'TICKET_CLIENT_MISMATCH');
  db.prepare('UPDATE clients SET active=1 WHERE id=?').run('salarypay');
  clean();
});
test('refused, malformed or failed scope activation prevents search and validation and closes sessions', async () => {
  for (const failure of [false, { ok: true }, 'http']) {
    scopeFailure = failure;
    for (const operation of [() => glpiTickets('alice', config, '1141', 0, false), () => validateGlpiTicketSelection('alice', 1141, 'salarypay')]) {
      const start = calls.length;
      await assert.rejects(operation(), error => error.status === 502);
      assert(!calls.slice(start).some(call => call.path === 'search/Ticket' || call.path.startsWith('Ticket/')), 'never proceed with an unconfirmed scope');
      clean();
    }
  }
  scopeFailure = undefined;
});
