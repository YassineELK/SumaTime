import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { mockGlpi } from './glpi-mock.mjs';

// This is intentionally a standalone integration harness rather than a unit
// mock: React calls the built Next server, Next calls the loopback GLPI mock,
// and the database is recreated under /dev/shm for every run.
const repo = process.cwd();
const runtime = mkdtempSync('/dev/shm/sumatime-glpi-r2-integration-');
const databasePath = resolve(runtime, 'integration.sqlite');
const setupToken = 'r2-integration-setup-token';
const rawFetch = globalThis.fetch.bind(globalThis);
const originalCwd = process.cwd();
const cookies = new Map();
let currentBase = '';
let activeCookie = '';
let dropNextCreateResponse = false;
let holdNextPending = false;
let releaseHeldPending;
let appChild;
let glpi;
let checks = 0;

const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };

function wait(milliseconds) { return new Promise(resolveWait => setTimeout(resolveWait, milliseconds)); }
async function freePort() {
  const server = createServer();
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

async function waitReady(base, child) {
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

async function startServer({ database, appPort, mockPort, token = setupToken }) {
  const base = `http://127.0.0.1:${appPort}`;
  const env = {
    ...process.env,
    DATABASE_PATH: database,
    SETUP_TOKEN: token,
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
  await waitReady(base, child);
  return { child, base };
}

async function stopServer(child, signal = 'SIGKILL') {
  if (!child || child.exitCode !== null) return;
  child.kill(signal);
  await new Promise(resolveExit => child.once('exit', resolveExit));
}

async function processCreate(payload, cookie) {
  const script = `
    const response = await fetch(process.env.R2_BASE + '/api/glpi', {
      method: 'POST',
      headers: { Cookie: process.env.R2_COOKIE, Origin: process.env.R2_BASE, 'Content-Type': 'application/json' },
      body: process.env.R2_PAYLOAD,
    });
    console.log(JSON.stringify({ status: response.status, body: await response.json() }));
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
    cwd: repo,
    env: { ...process.env, R2_BASE: currentBase, R2_COOKIE: cookie, R2_PAYLOAD: JSON.stringify(payload) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += String(chunk); });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  return new Promise((resolveProcess, rejectProcess) => child.once('exit', code => {
    if (code !== 0) return rejectProcess(new Error(`process create failed: ${stderr || stdout}`));
    try { resolveProcess(JSON.parse(stdout.trim().split('\n').at(-1))); }
    catch { rejectProcess(new Error(`process create returned invalid JSON: ${stdout} ${stderr}`)); }
  }));
}

async function api(user, payload, path = '/api/auth', expected = 200) {
  const headers = {};
  const cookie = cookies.get(user);
  if (cookie) headers.Cookie = cookie;
  if (payload) { headers.Origin = currentBase; headers['Content-Type'] = 'application/json'; }
  const response = await rawFetch(currentBase + path, { method: payload ? 'POST' : 'GET', headers, body: payload ? JSON.stringify(payload) : undefined });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookies.set(user, setCookie.split(';', 1)[0]);
  const text = await response.text();
  let value;
  try { value = text ? JSON.parse(text) : null; } catch { value = text; }
  assert.equal(response.status, expected, `${path} returned ${response.status}: ${text}`);
  checks++;
  return value;
}

function ticketCalls() { return glpi.calls.filter(call => call.method === 'POST' && call.path === 'Ticket'); }

function storageQuota() { return { getItem: () => null, setItem: () => { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); }, removeItem: () => {} }; }
function storageCorrupt() { return { getItem: () => '{"version":2,"requests":[{"payload":"corrupt"}]}', setItem: () => {}, removeItem: () => {} }; }
function setStorage(value) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value });
  Object.defineProperty(dom.window, 'localStorage', { configurable: true, writable: true, value });
}

const dom = new JSDOM('<!doctype html><html><body><div id="root-a"></div><div id="root-b"></div></body></html>', { url: 'http://127.0.0.1/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLAnchorElement', 'Node', 'NodeFilter', 'Element', 'DocumentFragment', 'MutationObserver', 'getComputedStyle', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'FocusEvent']) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = id => clearTimeout(id);
globalThis.PointerEvent = dom.window.MouseEvent;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, writable: true, value: undefined });
Object.defineProperty(dom.window, 'BroadcastChannel', { configurable: true, writable: true, value: undefined });
if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value: dom.window.crypto });

const { createRoot } = await import('react-dom/client');
const { default: NewGlpiTicket } = await import('../app/new-glpi-ticket.tsx');

globalThis.fetch = async (input, init = {}) => {
  const target = new URL(String(input), currentBase);
  const headers = new Headers(init.headers);
  if (activeCookie) headers.set('Cookie', activeCookie);
  if (String(init.method || 'GET').toUpperCase() === 'POST') headers.set('Origin', currentBase);
  const body = typeof init.body === 'string' ? (() => { try { return JSON.parse(init.body); } catch { return null; } })() : null;
  const response = await rawFetch(target, { ...init, headers });
  if (target.pathname === '/api/glpi' && body?.action === 'createTicket' && dropNextCreateResponse) {
    dropNextCreateResponse = false;
    await response.arrayBuffer();
    throw new TypeError('simulated browser response loss after provider acceptance');
  }
  if (target.pathname === '/api/glpi' && target.search === '?uncertain=1' && holdNextPending) {
    holdNextPending = false;
    return new Promise(resolvePending => { releaseHeldPending = () => resolvePending(response); });
  }
  return response;
};
Object.defineProperty(dom.window, 'fetch', { configurable: true, writable: true, value: globalThis.fetch });

function button(container, label) { return [...container.querySelectorAll('button')].find(value => value.textContent?.includes(label)); }
function setField(container, selector, value) {
  const field = container.querySelector(selector);
  assert.ok(field, `Missing ${selector}: ${container.textContent}`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(field.constructor.prototype, 'value')?.set;
    setter?.call(field, value);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    field.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
}
async function settle(milliseconds = 100) { await act(async () => { await wait(milliseconds); }); }
async function waitFor(predicate, timeout = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return;
    await settle(30);
  }
  throw new Error(`UI condition timed out: ${document.body.textContent}`);
}
async function renderTicket(root, memberId, clients, initialClient = '') {
  await act(async () => {
    root.render(React.createElement(NewGlpiTicket, { clients, memberId, initialClient, onCreated: () => {} }));
    await wait(30);
  });
}
async function mountTicket(memberId, clients, containerId = 'root-a', initialClient = '') {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const root = createRoot(container);
  await renderTicket(root, memberId, clients, initialClient);
  await settle(500);
  return { root, container };
}
async function unmountTicket(mounted) {
  await act(async () => { mounted.root.unmount(); await wait(50); });
  mounted.container.innerHTML = '';
}
async function openFresh(container) {
  const newButton = button(container, 'Nouveau ticket GLPI');
  assert.ok(newButton, 'new-ticket button exists');
  await act(async () => { newButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(250); });
  await waitFor(() => !!document.querySelector('form.quick-form') || /Ticket créé dans GLPI|Résultat incertain|Connexion GLPI/.test(document.body.textContent));
}
async function submitTicket(container, client, title, description) {
  await openFresh(container);
  const form = document.querySelector('form.quick-form');
  assert.ok(form, `form exists before submit: ${document.body.textContent}`);
  setField(form, 'select', client.id);
  setField(form, 'input[maxlength="250"]', title);
  setField(form, 'textarea', description);
  await settle(500);
  await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await wait(650); });
}
async function consumeTicket() {
  const consume = button(document, 'Utiliser ce ticket');
  assert.ok(consume, `explicit consumption button exists: ${document.body.textContent}`);
  await act(async () => { consume.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(450); });
}

async function setupUsersAndClient() {
  await api('admin', { action: 'setup', name: 'R2 Admin', email: 'r2-admin@example.test', password: 'R2-Admin-Password-2026!', token: setupToken });
  await api('admin', { action: 'account', name: 'R2 Alice', email: 'r2-alice@example.test', password: 'R2-Temporary-2026!' });
  await api('admin', { action: 'account', name: 'R2 Bob', email: 'r2-bob@example.test', password: 'R2-Temporary-2026!' });
  await api('alice', { action: 'login', login: 'r2-alice@example.test', password: 'R2-Temporary-2026!' });
  await api('alice', { action: 'password', current: 'R2-Temporary-2026!', password: 'R2-Alice-Password-2026!' });
  await api('bob', { action: 'login', login: 'r2-bob@example.test', password: 'R2-Temporary-2026!' });
  await api('bob', { action: 'password', current: 'R2-Temporary-2026!', password: 'R2-Bob-Password-2026!' });
  await api('admin', { action: 'client', name: 'R2 Client' }, '/api/time');
  let state = await api('admin', null, '/api/time');
  let client = state.clients.find(item => item.name === 'R2 Client');
  assert.ok(client);
  await api('admin', { action: 'clientGlpi', id: client.id, entity: 4 }, '/api/time');
  state = await api('admin', null, '/api/time');
  client = state.clients.find(item => item.id === client.id);
  await api('alice', { action: 'connect', token: 'alice-test-token' }, '/api/glpi');
  const alice = state.members.find(item => item.email === 'r2-alice@example.test');
  const bob = state.members.find(item => item.email === 'r2-bob@example.test');
  assert.ok(alice && bob && client?.glpi_entity_id === 4);
  return { alice, bob, client, clients: [client] };
}

async function main() {
  const appPort = await freePort();
  const mockPort = await freePort();
  glpi = await mockGlpi(mockPort);
  const started = await startServer({ database: databasePath, appPort, mockPort });
  appChild = started.child;
  currentBase = started.base;
  const users = await setupUsersAndClient();
  const alice = users.alice;
  const bob = users.bob;
  const client = users.client;

  // P2-1 + crash/restart: quota storage loses only the browser response. The
  // provider creates once, the DB survives a Next SIGKILL, and explicit
  // consumption is the only ACK.
  setStorage(storageQuota());
  activeCookie = cookies.get('alice');
  dropNextCreateResponse = true;
  let mounted = await mountTicket(alice.id, users.clients);
  await submitTicket(mounted.container, client, 'QUOTA RESPONSE LOSS', 'Quota storage must recover server result');
  equal(ticketCalls().length, 1, 'quota response loss performs one provider Ticket POST');
  ok(/Résultat incertain/.test(document.body.textContent), 'quota response loss is explicit uncertainty');
  const persistedQuota = await api('alice', null, '/api/glpi?uncertain=1');
  ok(persistedQuota.requests?.[0]?.ticket, `server persists the accepted result before restart: ${JSON.stringify(persistedQuota)}`);
  await unmountTicket(mounted);
  await stopServer(appChild, 'SIGKILL');
  appChild = undefined;
  const restarted = await startServer({ database: databasePath, appPort, mockPort });
  appChild = restarted.child;
  currentBase = restarted.base;
  const persistedAfterRestart = await api('alice', null, '/api/glpi?uncertain=1');
  ok(persistedAfterRestart.requests?.[0]?.ticket, `server keeps the result after SIGKILL: ${JSON.stringify(persistedAfterRestart)}`);
  activeCookie = cookies.get('alice');
  mounted = await mountTicket(alice.id, users.clients);
  await openFresh(mounted.container);
  await waitFor(() => /Ticket créé dans GLPI|Résultat récupéré/.test(document.body.textContent));
  ok(/Ticket créé dans GLPI|Résultat récupéré/.test(document.body.textContent), `restart remount recovers the same server result: ${document.body.textContent}`);
  equal(ticketCalls().length, 1, 'crash/restart recovery does not POST a second Ticket');
  await consumeTicket();
  const afterQuota = await api('alice', null, '/api/glpi?uncertain=1');
  equal(afterQuota.requests, [], 'explicit consumption removes the recovered result');
  await unmountTicket(mounted);

  // P2-1 storage variants: corruption and disabled storage both use the same
  // server operation and never auto-ACK at mount or recovery.
  for (const [label, storage] of [['CORRUPT STORAGE', storageCorrupt()], ['DISABLED STORAGE', null]]) {
    setStorage(storage);
    activeCookie = cookies.get('alice');
    dropNextCreateResponse = true;
    mounted = await mountTicket(alice.id, users.clients);
    await submitTicket(mounted.container, client, label, `${label} uses server authority`);
    equal(ticketCalls().length, label === 'CORRUPT STORAGE' ? 2 : 3, `${label} emits exactly one provider Ticket POST`);
    await unmountTicket(mounted);
    mounted = await mountTicket(alice.id, users.clients);
    await openFresh(mounted.container);
    await waitFor(() => /Ticket créé dans GLPI|Résultat récupéré/.test(document.body.textContent));
    ok(/Ticket créé dans GLPI|Résultat récupéré/.test(document.body.textContent), `${label} remount recovers the result`);
    await consumeTicket();
    equal((await api('alice', null, '/api/glpi?uncertain=1')).requests, [], `${label} explicit consumption clears the server row`);
    await unmountTicket(mounted);
  }

  // P2-2 stale tab and Alice → Bob → Alice: hold a real Alice response from
  // Next, switch the same React root to Bob, then release it. Private fields
  // must never render in Bob; Alice can later recover her own result.
  setStorage(null);
  activeCookie = cookies.get('alice');
  dropNextCreateResponse = true;
  mounted = await mountTicket(alice.id, users.clients);
  await submitTicket(mounted.container, client, 'ALICE PRIVATE TITLE', 'ALICE PRIVATE DESCRIPTION');
  await unmountTicket(mounted);
  holdNextPending = true;
  activeCookie = cookies.get('alice');
  mounted = await mountTicket(alice.id, users.clients);
  await waitFor(() => typeof releaseHeldPending === 'function');
  activeCookie = cookies.get('bob');
  await renderTicket(mounted.root, bob.id, users.clients);
  await settle(250);
  releaseHeldPending?.();
  releaseHeldPending = undefined;
  await settle(250);
  ok(!/ALICE PRIVATE TITLE|ALICE PRIVATE DESCRIPTION/.test(mounted.container.textContent), 'late Alice response cannot mutate Bob UI');
  activeCookie = cookies.get('alice');
  await renderTicket(mounted.root, alice.id, users.clients);
  await settle(350);
  await openFresh(mounted.container);
  await waitFor(() => /ALICE PRIVATE TITLE/.test(document.body.textContent));
  ok(/ALICE PRIVATE TITLE/.test(document.body.textContent), 'Alice recovers the private result after Bob switch');
  await consumeTicket();
  equal(ticketCalls().length, 4, 'Alice → Bob → Alice recovery emits no duplicate Ticket POST');
  await unmountTicket(mounted);

  // P2-3 independent simultaneous tabs/process-like roots: both UUIDs have
  // the same canonical payload, while local storage and BroadcastChannel are
  // disabled. SQLite fingerprint reservation must select one operation.
  setStorage(null);
  activeCookie = cookies.get('alice');
  const tabA = await mountTicket(alice.id, users.clients, 'root-a');
  const tabB = await mountTicket(alice.id, users.clients, 'root-b');
  await openFresh(tabA.container);
  await openFresh(tabB.container);
  await waitFor(() => document.querySelectorAll('form.quick-form').length >= 2);
  const [formA, formB] = [...document.querySelectorAll('form.quick-form')];
  assert.ok(formA && formB);
  setField(formA, 'select', client.id); setField(formA, 'input[maxlength="250"]', 'SIMULTANEOUS FINGERPRINT'); setField(formA, 'textarea', 'Two independent tabs must reserve one operation');
  setField(formB, 'select', client.id); setField(formB, 'input[maxlength="250"]', 'SIMULTANEOUS FINGERPRINT'); setField(formB, 'textarea', 'Two independent tabs must reserve one operation');
  await settle(500);
  const processPayloads = [randomUUID(), randomUUID()].map(request_id => ({
    action: 'createTicket', request_id, client_id: client.id, title: 'SIMULTANEOUS FINGERPRINT',
    description: 'Two independent tabs must reserve one operation', type: 1, urgency: 3, category: 0,
  }));
  const processCreates = Promise.all(processPayloads.map(payload => processCreate(payload, cookies.get('alice'))));
  await act(async () => {
    formA.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    formB.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await wait(900);
  });
  const processResults = await processCreates;
  ok(processResults.every(result => result.status === 200 || result.status === 409), 'independent process clients receive only authoritative 200/409 responses');
  ok(processResults.some(result => result.body.ticket || result.body.operation), 'independent process clients receive the authoritative operation/result');
  equal(ticketCalls().length, 5, 'simultaneous independent tabs emit one provider Ticket POST');
  const simultaneous = await api('alice', null, '/api/glpi?uncertain=1');
  const authoritative = simultaneous.requests.find(request => request.payload.title === 'SIMULTANEOUS FINGERPRINT');
  ok(authoritative?.ticket, 'second tab receives the authoritative operation/result');
  await api('alice', { action: 'acknowledgeCreation', request_id: authoritative.payload.request_id, ticket_id: authoritative.ticket.id }, '/api/glpi');
  await unmountTicket(tabA); await unmountTicket(tabB);
  const mainTicketCount = ticketCalls().length;
  equal(mainTicketCount, 5, 'main loopback mock saw exactly five accepted provider Ticket POSTs');

  // P2-5 exact old schema clone: the real Next migration normalizes a
  // result-only row as acknowledged/legacy-safe, so the UI remains usable.
  await stopServer(appChild, 'SIGKILL');
  appChild = undefined;
  glpi.server.closeAllConnections();
  await new Promise(resolveClose => glpi.server.close(resolveClose));
  const legacyPort = await freePort();
  const legacyAppPort = await freePort();
  const legacyRoot = mkdtempSync('/dev/shm/sumatime-glpi-r2-legacy-');
  const legacyDb = resolve(legacyRoot, 'legacy.sqlite');
  const legacy = new DatabaseSync(legacyDb);
  legacy.exec(readFileSync(resolve(repo, 'drizzle/0000_spotty_luminals.sql'), 'utf8'));
  legacy.exec(`INSERT INTO members(id,email,name,role,active,created_at) VALUES ('legacy-member','legacy@example.test','Legacy Admin','admin',1,'2026-01-01T00:00:00.000Z');
    INSERT INTO clients(id,name,active) VALUES ('legacy-client','Legacy Client',1);
    CREATE TABLE glpi_creations (request_id TEXT PRIMARY KEY, member_id TEXT NOT NULL, api_url TEXT NOT NULL, payload_hash TEXT NOT NULL, result_json TEXT, created_at TEXT NOT NULL);
    INSERT INTO glpi_creations VALUES ('11111111-1111-1111-1111-111111111111','legacy-member','http://127.0.0.1:${legacyPort}/apirest.php','legacy-hash','{"id":301,"title":"Legacy result","status":1,"entity":4,"url":"http://127.0.0.1:${legacyPort}/front/ticket.form.php?id=301","client_id":null,"client":null}','2026-01-01T00:00:00.000Z');`);
  legacy.close();
  glpi = await mockGlpi(legacyPort);
  const legacyStarted = await startServer({ database: legacyDb, appPort: legacyAppPort, mockPort: legacyPort, token: 'legacy-setup-token' });
  appChild = legacyStarted.child;
  currentBase = legacyStarted.base;
  await api('legacy', { action: 'setup', name: 'Legacy Admin', email: 'legacy@example.test', password: 'Legacy-Password-2026!', token: 'legacy-setup-token' });
  let legacyState = await api('legacy', null, '/api/time');
  const legacyClient = legacyState.clients.find(item => item.id === 'legacy-client');
  await api('legacy', { action: 'clientGlpi', id: legacyClient.id, entity: 4 }, '/api/time');
  await api('legacy', { action: 'connect', token: 'admin-test-token' }, '/api/glpi');
  const normalized = await api('legacy', null, '/api/glpi?uncertain=1');
  equal(normalized.requests, [], 'legacy result-only row is not a false recovery blocker');
  equal(normalized.blocked, false, 'legacy migration reports no corrupt blocking state');
  legacyState = await api('legacy', null, '/api/time');
  legacyState = { ...legacyState, clients: legacyState.clients.filter(item => item.id === legacyClient.id) };
  setStorage(null);
  activeCookie = cookies.get('legacy');
  mounted = await mountTicket('legacy-member', legacyState.clients, 'root-a', legacyClient.id);
  await openFresh(mounted.container);
  await settle(800);
  const legacyForm = document.querySelector('form.quick-form');
  const legacyCreate = document.querySelector('form.quick-form button.primary');
  ok(legacyForm && legacyCreate && !legacyCreate.disabled, `UI remains usable after exact legacy schema migration: ${document.body.textContent}`);
  await unmountTicket(mounted);
  await stopServer(appChild, 'SIGKILL');
  appChild = undefined;
  glpi.server.closeAllConnections();
  await new Promise(resolveClose => glpi.server.close(resolveClose));
  console.log(`GLPI R2 React → Next → mock integration: ${checks} assertions passed; main mock provider Ticket POST=${mainTicketCount}.`);
}

try {
  await main();
} finally {
  if (appChild) await stopServer(appChild).catch(() => {});
  try { glpi?.server.closeAllConnections(); glpi?.server.close(); } catch {}
  process.chdir(originalCwd);
}
