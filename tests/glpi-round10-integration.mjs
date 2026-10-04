import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { mockGlpi } from './glpi-mock.mjs';
import { glpiUncertainStorageKey } from '../lib/glpi-draft.ts';

// Real React -> Next -> loopback mock GLPI coverage for an issued distinct
// draft whose capability expires before reservation. The browser is forced
// through remount, storage failure and one auth loss; the mock provider must
// see only one Ticket POST per explicit renewal and never the old result.
const repo = process.cwd();
const runtime = mkdtempSync('/dev/shm/sumatime-glpi-round10-');
const databasePath = resolve(runtime, 'round10.sqlite');
const setupToken = randomBytes(24).toString('hex');
const rawFetch = globalThis.fetch.bind(globalThis);
const cookies = new Map();
let base = '';
let appChild;
let mock;
let loseNextCreateAuth = false;
const beginBodies = [];
const createBodies = [];

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLAnchorElement', 'Node', 'NodeFilter', 'Element', 'DocumentFragment', 'MutationObserver', 'getComputedStyle', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'FocusEvent']) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: dom.window.localStorage });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = id => clearTimeout(id);
globalThis.PointerEvent = dom.window.MouseEvent;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value: dom.window.crypto });
const { createRoot } = await import('react-dom/client');
const { default: NewGlpiTicket } = await import('../app/new-glpi-ticket.tsx');

function wait(milliseconds) { return new Promise(resolveWait => setTimeout(resolveWait, milliseconds)); }
async function port() {
  const server = createServer();
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const value = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return value;
}
async function ready(child) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Next stopped during Round 10 integration startup');
    try { if ((await rawFetch(base + '/api/auth')).ok) return; } catch {}
    await wait(100);
  }
  throw new Error('Next readiness timeout');
}
async function start(appPort, mockPort) {
  base = `http://127.0.0.1:${appPort}`;
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
  await ready(child);
  return child;
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise(resolveExit => child.once('exit', resolveExit));
}
async function api(user, payload, path = '/api/auth', expected = 200) {
  const headers = {};
  if (cookies.has(user)) headers.Cookie = cookies.get(user);
  if (payload) { headers.Origin = base; headers['Content-Type'] = 'application/json'; }
  const response = await rawFetch(base + path, { method: payload ? 'POST' : 'GET', headers, body: payload ? JSON.stringify(payload) : undefined });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookies.set(user, setCookie.split(';', 1)[0]);
  const text = await response.text();
  assert.equal(response.status, expected, `${path}: ${text}`);
  return text ? JSON.parse(text) : null;
}

globalThis.fetch = async (input, init = {}) => {
  const target = new URL(String(input), base);
  const headers = new Headers(init.headers);
  const cookie = cookies.get('alice');
  if (cookie && !loseNextCreateAuth) headers.set('Cookie', cookie);
  if (String(init.method || 'GET').toUpperCase() === 'POST') headers.set('Origin', base);
  const body = typeof init.body === 'string' ? (() => { try { return JSON.parse(init.body); } catch { return null; } })() : null;
  const isCreate = target.pathname === '/api/glpi' && body?.action === 'createTicket';
  if (target.pathname === '/api/glpi' && body?.action === 'beginDistinctCreation') beginBodies.push({ ...body });
  if (isCreate) {
    createBodies.push({ ...body });
    if (loseNextCreateAuth) {
      loseNextCreateAuth = false;
      headers.delete('Cookie');
    }
  }
  return rawFetch(target, { ...init, headers });
};
Object.defineProperty(dom.window, 'fetch', { configurable: true, writable: true, value: globalThis.fetch });

function button(label) { return [...document.querySelectorAll('button')].find(value => value.textContent?.includes(label)); }
function click(value) { assert.ok(value, `missing button in UI: ${document.body.textContent}`); act(() => value.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))); }
function field(selector, value) {
  const target = document.querySelector(selector);
  assert.ok(target, `missing ${selector}: ${document.body.textContent}`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(target.constructor.prototype, 'value')?.set;
    setter?.call(target, value);
    target.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    target.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
}
async function settle(milliseconds = 100) { await act(async () => { await wait(milliseconds); }); }
async function open() { click(button('Nouveau ticket GLPI')); await settle(180); }
async function submit() {
  const form = document.querySelector('form.quick-form');
  assert.ok(form, document.body.textContent);
  act(() => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  await settle(350);
}
async function mount(memberId) {
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(NewGlpiTicket, { clients: [globalThis.round10Client], memberId, onCreated: () => {} })); await wait(80); });
  return root;
}
async function unmount(root) { await act(async () => { root.unmount(); await wait(20); }); document.getElementById('root').innerHTML = ''; }
function setIntentExpiry(requestId, value) {
  const control = new DatabaseSync(databasePath);
  const row = control.prepare('SELECT intent_id FROM glpi_creation_intents WHERE draft_request_id=? ORDER BY created_at DESC LIMIT 1').get(requestId);
  assert.ok(row, `missing server marker for ${requestId}`);
  control.prepare('UPDATE glpi_creation_intents SET expires_at=? WHERE intent_id=?').run(value, row.intent_id);
  control.close();
  return row.intent_id;
}
function setLocalMarkerExpiry(memberId, requestId, value) {
  const key = glpiUncertainStorageKey(memberId);
  const store = JSON.parse(localStorage.getItem(key));
  const item = store.requests.find(entry => entry.payload.request_id === requestId);
  assert.ok(item, `missing browser marker for ${requestId}`);
  assert.ok(item.distinctIntent);
  item.distinctIntent.expiresAt = value;
  localStorage.setItem(key, JSON.stringify(store));
}

try {
  const appPort = await port();
  const mockPort = await port();
  mock = await mockGlpi(mockPort);
  appChild = await start(appPort, mockPort);
  await api('admin', { action: 'setup', name: 'Round 10 admin', email: 'round10-admin@example.test', password: 'Round10-Admin-Password!', token: setupToken });
  await api('admin', { action: 'account', name: 'Round 10 Alice', email: 'round10-alice@example.test', password: 'Round10-Temporary-Password!' });
  await api('alice', { action: 'login', login: 'round10-alice@example.test', password: 'Round10-Temporary-Password!' });
  await api('alice', { action: 'password', current: 'Round10-Temporary-Password!', password: 'Round10-Alice-Password!' });
  let state = await api('admin', null, '/api/time');
  let client = state.clients.find(item => item.name === 'Round 10 client');
  if (!client) { await api('admin', { action: 'client', name: 'Round 10 client' }, '/api/time'); state = await api('admin', null, '/api/time'); client = state.clients.find(item => item.name === 'Round 10 client'); }
  await api('admin', { action: 'clientGlpi', id: client.id, entity: 4 }, '/api/time');
  globalThis.round10Client = { ...client, glpi_entity_id: 4 };
  await api('alice', { action: 'connect', token: 'alice-test-token' }, '/api/glpi');
  const memberId = state.members.find(item => item.email === 'round10-alice@example.test').id;

  // Establish the older completed result that must never be returned to the
  // later explicitly distinct draft.
  localStorage.clear();
  let root = await mount(memberId);
  await open();
  field('select', client.id); field('input[maxlength="250"]', 'ROUND10 SAME'); field('textarea', 'Round10 expiry continuity.');
  await settle(180); await submit();
  assert.match(document.body.textContent, /Ticket créé dans GLPI/);
  click(button('Utiliser ce ticket')); await settle(220); await unmount(root);

  // Request a distinct UUID, then expire the server marker exactly before
  // reservation. The response must be explicit; no mock Ticket POST occurs.
  root = await mount(memberId); await open();
  field('select', client.id); field('input[maxlength="250"]', 'ROUND10 SAME'); field('textarea', 'Round10 expiry continuity.');
  await settle(180); await submit();
  assert.match(document.body.textContent, /Nouvelle demande distincte requise/);
  click(button('Commencer une nouvelle demande distincte')); await settle(260);
  const firstBegin = beginBodies.at(-1);
  assert.ok(firstBegin?.draft_request_id);
  setIntentExpiry(firstBegin.draft_request_id, new Date(Date.now()).toISOString());
  const providerBeforeExpiry = mock.calls.filter(call => call.method === 'POST' && call.path === 'Ticket').length;
  await submit();
  await settle(100);
  setLocalMarkerExpiry(memberId, firstBegin.draft_request_id, new Date(Date.now()).toISOString());
  assert.match(document.body.textContent, /Intention distincte expirée/);
  assert.equal(mock.calls.filter(call => call.method === 'POST' && call.path === 'Ticket').length, providerBeforeExpiry);
  const expiredBody = createBodies.at(-1);
  assert.equal(expiredBody.request_id, firstBegin.draft_request_id);
  assert.notEqual(expiredBody.request_id, createBodies[0].request_id);

  // Reload/remount reads the expired marker, then storage is made unavailable
  // before renewal. The server marker still binds the same UUID.
  await unmount(root); root = await mount(memberId); await open();
  assert.match(document.body.textContent, /Intention distincte expirée/);
  const storage = globalThis.localStorage;
  const originalStorage = { getItem: storage.getItem, setItem: storage.setItem, removeItem: storage.removeItem };
  Object.defineProperty(storage, 'getItem', { configurable: true, value() { throw new Error('storage unavailable'); } });
  Object.defineProperty(storage, 'setItem', { configurable: true, value() { throw new Error('storage unavailable'); } });
  Object.defineProperty(storage, 'removeItem', { configurable: true, value() { throw new Error('storage unavailable'); } });
  click(button('Renouveler l’intention distincte')); await settle(280);
  const renewedBegin = beginBodies.at(-1);
  assert.equal(renewedBegin.draft_request_id, firstBegin.draft_request_id);
  await submit();
  assert.match(document.body.textContent, /Ticket créé dans GLPI/);
  const providerAfterRenewal = mock.calls.filter(call => call.method === 'POST' && call.path === 'Ticket').length;
  assert.equal(providerAfterRenewal, providerBeforeExpiry + 1, 'one renewal creates one provider ticket');
  const renewedBody = createBodies.at(-1);
  assert.equal(renewedBody.request_id, firstBegin.draft_request_id);
  assert.notEqual(renewedBody.request_id, createBodies[0].request_id, 'renewal never replays the old operation UUID');
  Object.defineProperty(storage, 'getItem', { configurable: true, value: originalStorage.getItem });
  Object.defineProperty(storage, 'setItem', { configurable: true, value: originalStorage.setItem });
  Object.defineProperty(storage, 'removeItem', { configurable: true, value: originalStorage.removeItem });
  click(button('Utiliser ce ticket')); await settle(220); await unmount(root);

  // Auth loss before reservation is still fail-closed. After the capability
  // expires, recovery transitions to explicit renewal; it does not replay the
  // first ticket and still permits only one new provider POST.
  root = await mount(memberId); await open();
  field('select', client.id); field('input[maxlength="250"]', 'ROUND10 SAME'); field('textarea', 'Round10 expiry continuity.');
  await settle(180); await submit();
  click(button('Commencer une nouvelle demande distincte')); await settle(260);
  const authLossBegin = beginBodies.at(-1);
  loseNextCreateAuth = true; await submit();
  assert.match(document.body.textContent, /Résultat incertain/);
  const providerBeforeAuthRenewal = mock.calls.filter(call => call.method === 'POST' && call.path === 'Ticket').length;
  assert.equal(providerBeforeAuthRenewal, providerAfterRenewal);
  setIntentExpiry(authLossBegin.draft_request_id, new Date(Date.now() - 1).toISOString());
  click(button('Récupérer le résultat')); await settle(350);
  assert.match(document.body.textContent, /Intention distincte expirée/);
  assert.equal(mock.calls.filter(call => call.method === 'POST' && call.path === 'Ticket').length, providerBeforeAuthRenewal);
  click(button('Renouveler l’intention distincte')); await settle(280);
  assert.equal(beginBodies.at(-1).draft_request_id, authLossBegin.draft_request_id);
  await submit();
  assert.match(document.body.textContent, /Ticket créé dans GLPI/);
  assert.equal(mock.calls.filter(call => call.method === 'POST' && call.path === 'Ticket').length, providerBeforeAuthRenewal + 1);
  assert.equal(createBodies.at(-1).request_id, authLossBegin.draft_request_id);
  assert.notEqual(createBodies.at(-1).request_id, createBodies[0].request_id, 'auth-loss renewal never replays the old operation UUID');
  await unmount(root);
  console.log('Round 10 React → Next → mock integration: exact-expiry, remount, unavailable storage, auth loss and renewal PASS; one Ticket POST per renewed draft.');
} finally {
  if (appChild) await stop(appChild).catch(() => {});
  try { mock?.server.closeAllConnections(); mock?.server.close(); } catch {}
}
