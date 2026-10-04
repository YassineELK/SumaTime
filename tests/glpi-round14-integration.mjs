import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { mockGlpi } from './glpi-mock.mjs';
import { glpiAcknowledgedStorageKey, glpiUncertainStorageKey } from '../lib/glpi-draft.ts';

// Real boundary: React -> Next route -> SQLite reservation/ACK -> loopback
// GLPI mock. The app is killed and restarted between the quota ACK and its
// explicit recovery, so module memory and sessionStorage cannot hide a bug.
const repo = process.cwd();
const runtime = mkdtempSync('/dev/shm/sumatime-glpi-round14-integration-');
const databasePath = resolve(runtime, 'round14.sqlite');
const setupToken = 'round14-integration-setup-token';
const rawFetch = globalThis.fetch.bind(globalThis);
const cookies = new Map();
let app;
let glpi;
let base = '';
let appPort;
let mockPort;
let checks = 0;

const check = (value, message) => { assert.ok(value, message); checks += 1; };
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };
const wait = milliseconds => new Promise(resolveWait => setTimeout(resolveWait, milliseconds));

async function freePort() {
  const server = createServer();
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

async function waitReady(child) {
  let logs = '';
  child.stdout?.on('data', chunk => { logs += String(chunk); });
  child.stderr?.on('data', chunk => { logs += String(chunk); });
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next stopped before readiness: ${logs}`);
    try {
      const response = await rawFetch(base + '/api/auth');
      if (response.ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error(`Next readiness timeout: ${logs}`);
}

async function startApp() {
  const env = {
    ...process.env,
    DATABASE_PATH: databasePath,
    SETUP_TOKEN: setupToken,
    APP_URL: base,
    TEST_URL: base,
    HOSTNAME: '127.0.0.1',
    PORT: String(appPort),
    LDAP_ENABLED: 'false',
    GLPI_API_URL: `http://127.0.0.1:${mockPort}/apirest.php`,
    GLPI_APP_TOKEN: 'mock-app-token',
    GLPI_WRITE_ENABLED: 'true',
    NEXT_TELEMETRY_DISABLED: '1',
  };
  const child = spawn(process.execPath, ['.next/standalone/server.js'], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  await waitReady(child);
  return child;
}

async function stopApp() {
  if (!app || app.exitCode !== null) return;
  app.kill('SIGKILL');
  await new Promise(resolveExit => app.once('exit', resolveExit));
  app = undefined;
}

async function api(user, payload, path = '/api/auth', expected = 200) {
  const headers = {};
  const cookie = cookies.get(user);
  if (cookie) headers.Cookie = cookie;
  if (payload) {
    headers.Origin = base;
    headers['Content-Type'] = 'application/json';
  }
  const response = await rawFetch(base + path, { method: payload ? 'POST' : 'GET', headers, body: payload ? JSON.stringify(payload) : undefined });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookies.set(user, setCookie.split(';', 1)[0]);
  const text = await response.text();
  let value;
  try { value = text ? JSON.parse(text) : null; } catch { value = text; }
  assert.equal(response.status, expected, `${path} returned ${response.status}: ${text}`);
  checks += 1;
  return value;
}

function providerTickets() {
  return glpi.calls.filter(call => call.method === 'POST' && call.path === 'Ticket');
}

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:5179/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLAnchorElement', 'Node', 'NodeFilter', 'Element', 'DocumentFragment', 'MutationObserver', 'getComputedStyle', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'FocusEvent']) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = id => clearTimeout(id);
globalThis.PointerEvent = dom.window.MouseEvent;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value: dom.window.crypto });
const { createRoot } = await import('react-dom/client');
const { default: NewGlpiTicket } = await import('../app/new-glpi-ticket.tsx');

globalThis.fetch = async (input, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Cookie', cookies.get('alice') || '');
  if (String(init.method || 'GET').toUpperCase() === 'POST') headers.set('Origin', base);
  return rawFetch(new URL(String(input), base), { ...init, headers });
};
Object.defineProperty(dom.window, 'fetch', { configurable: true, writable: true, value: globalThis.fetch });

function button(label) { return [...document.querySelectorAll('button')].find(value => value.textContent?.includes(label)); }
function setField(field, value) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(field.constructor.prototype, 'value')?.set;
    setter?.call(field, value);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    field.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
}
async function settle(milliseconds = 50) { await act(async () => { await wait(milliseconds); }); }
async function waitFor(predicate, timeout = 7000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return;
    await settle(30);
  }
  throw new Error(`UI condition timed out: ${document.body.textContent}`);
}
async function mount() {
  const container = document.getElementById('root');
  container.innerHTML = '';
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(NewGlpiTicket, { clients: [globalThis.round14Client], memberId: globalThis.round14Alice, onCreated: () => { globalThis.round14Callbacks += 1; } })); await wait(450); });
  return { root, container };
}
async function unmount(mounted) {
  await act(async () => { mounted.root.unmount(); await wait(50); });
  mounted.container.innerHTML = '';
}
async function openNew(container) {
  const trigger = button('Nouveau ticket GLPI');
  assert.ok(trigger, container.textContent);
  await act(async () => { trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(350); });
  await waitFor(() => !!document.querySelector('form.quick-form') || /Résultat incertain|Ticket créé/.test(document.body.textContent));
}
async function fillAndSubmit(title) {
  const form = document.querySelector('form.quick-form');
  assert.ok(form, document.body.textContent);
  setField(form.querySelector('select'), globalThis.round14Client.id);
  setField(form.querySelector('input[maxlength="250"]'), title);
  setField(form.querySelector('textarea'), 'Round 14 real Next SQLite cold-process proof');
  await waitFor(() => !form.querySelector('fieldset')?.disabled && !form.querySelector('button.primary')?.disabled);
  await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await wait(700); });
  await waitFor(() => /Ticket créé dans GLPI|Résultat incertain/.test(document.body.textContent));
}

async function setup() {
  await api('admin', { action: 'setup', name: 'Round 14 Admin', email: 'round14-admin@example.test', password: 'Round14-Admin-Password-2026!', token: setupToken });
  await api('admin', { action: 'account', name: 'Round 14 Alice', email: 'round14-alice@example.test', password: 'Round14-Temporary-2026!' });
  await api('alice', { action: 'login', login: 'round14-alice@example.test', password: 'Round14-Temporary-2026!' });
  await api('alice', { action: 'password', current: 'Round14-Temporary-2026!', password: 'Round14-Alice-Password-2026!' });
  await api('admin', { action: 'client', name: 'Round 14 Client' }, '/api/time');
  let state = await api('admin', null, '/api/time');
  let client = state.clients.find(value => value.name === 'Round 14 Client');
  await api('admin', { action: 'clientGlpi', id: client.id, entity: 4 }, '/api/time');
  state = await api('admin', null, '/api/time');
  client = state.clients.find(value => value.id === client.id);
  await api('alice', { action: 'connect', token: 'alice-test-token' }, '/api/glpi');
  const alice = (await api('alice', null, '/api/time')).me;
  globalThis.round14Alice = alice.id;
  globalThis.round14Client = client;
}

async function main() {
  appPort = await freePort();
  mockPort = await freePort();
  base = `http://127.0.0.1:${appPort}`;
  glpi = await mockGlpi(mockPort);
  app = await startApp();
  await setup();

  dom.window.localStorage.clear();
  dom.window.sessionStorage.clear();
  globalThis.round14Callbacks = 0;
  let mounted = await mount();
  await openNew(mounted.container);
  await fillAndSubmit('Round 14 quota ACK through Next');
  const providerBeforeAck = providerTickets().length;
  const storagePrototype = Object.getPrototypeOf(dom.window.localStorage);
  const originalSetItem = storagePrototype.setItem;
  const ackKey = glpiAcknowledgedStorageKey(globalThis.round14Alice);
  storagePrototype.setItem = function (key, value) {
    if (key === ackKey) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    return originalSetItem.call(this, key, value);
  };
  await act(async () => { button('Utiliser ce ticket').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(500); });
  equal(providerTickets().length, providerBeforeAck, 'ACK quota path never sends another provider Ticket');
  equal(globalThis.round14Callbacks, 0, 'non-durable ACK never calls onCreated');
  equal(dom.window.sessionStorage.getItem(ackKey), null, 'sessionStorage never certifies ACK consumption');
  check(dom.window.localStorage.getItem(glpiUncertainStorageKey(globalThis.round14Alice)), 'UUID/payload remains in local recovery state after quota');
  await unmount(mounted);

  await stopApp();
  storagePrototype.setItem = originalSetItem;
  dom.window.sessionStorage.clear();
  app = await startApp();
  mounted = await mount();
  await openNew(mounted.container);
  check(/Résultat incertain/.test(document.body.textContent), 'cold process requires explicit result recovery');
  await act(async () => { button('Récupérer le résultat').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(700); });
  await waitFor(() => /Ticket créé dans GLPI/.test(document.body.textContent));
  equal(providerTickets().length, providerBeforeAck, 'cold recovery replays the SQLite operation without a provider POST');
  await act(async () => { button('Utiliser ce ticket').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(500); });
  equal(globalThis.round14Callbacks, 1, 'durable ACK calls onCreated once');
  equal((await api('alice', null, '/api/glpi?uncertain=1')).requests, [], 'explicit ACK clears ordinary server recovery');
  await unmount(mounted);

  // Differential server/UI projection: inject two genuine generation-zero
  // abandoned rows for one UUID, then query the real route and create another
  // independent ticket through the real React path.
  const tombstone = 'aaaaaaaa-1111-1111-1111-111111111111';
  const db = new DatabaseSync(databasePath);
  const apiUrl = `http://127.0.0.1:${mockPort}/apirest.php`;
  for (const [id, at, draftPayload] of [
    ['f'.repeat(64), '2026-10-04T10:00:00.123Z', null],
    ['0'.repeat(64), '2026-10-04T10:00:01.123Z', JSON.stringify({ request_id: tombstone, client_id: globalThis.round14Client.id, title: 'abandoned', description: 'abandoned', type: 1, urgency: 3, category: 0 })],
  ]) {
    db.prepare(`INSERT INTO glpi_creation_intents
      (intent_id,member_id,api_url,draft_request_id,draft_payload_json,generation,created_at,expires_at,abandoned_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id, globalThis.round14Alice, apiUrl, tombstone, draftPayload, 0, at, '2099-01-01T00:00:00.000Z', at);
  }
  db.close();
  const projected = await api('alice', null, '/api/glpi?uncertain=1&recover=1');
  equal(projected.blocked, false, 'real API projection ignores inactive tombstones');
  equal(!!projected.distinctDrafts?.some(item => item.draft_request_id === tombstone), false, 'tombstones remain hidden from visible drafts');
  const blocked = await api('alice', { action: 'beginDistinctCreation', draft_request_id: tombstone, draft_payload: { request_id: tombstone, client_id: globalThis.round14Client.id, title: 'abandoned', description: 'abandoned', type: 1, urgency: 3, category: 0 } }, '/api/glpi', 409);
  equal(blocked.code, 'INTENT_ABANDONED', 'renewal of the abandoned UUID stays terminally fail-closed');

  globalThis.round14Callbacks = 0;
  mounted = await mount();
  await openNew(mounted.container);
  check(!!document.querySelector('form.quick-form'), 'an unrelated UUID remains creatable in the real UI');
  await fillAndSubmit('Round 14 independent UUID');
  equal(providerTickets().length, providerBeforeAck + 1, 'unrelated UUID creates exactly one provider ticket');
  await act(async () => { button('Utiliser ce ticket').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(500); });
  await unmount(mounted);
  console.log(`Round14 real React → Next → SQLite → mock/cold-process: ${checks} assertions; provider Ticket POST=${providerTickets().length}.`);
}

try {
  await main();
} finally {
  try { await stopApp(); } catch {}
  try { glpi?.server.closeAllConnections(); glpi?.server.close(); } catch {}
}
