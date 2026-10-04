import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { mockGlpi } from './glpi-mock.mjs';

// Real React → Next → loopback mock GLPI coverage for the two round-8
// transitions. No provider outside the local mock is contacted.
const repo = process.cwd();
const runtime = mkdtempSync('/dev/shm/sumatime-glpi-round9-');
const databasePath = resolve(runtime, 'round9.sqlite');
const setupToken = randomBytes(24).toString('hex');
const rawFetch = globalThis.fetch.bind(globalThis);
const cookies = new Map();
let base = '';
let appChild;
let mock;
let dropCreate = false;
let invalidateCreate = false;
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
    if (child.exitCode !== null) throw new Error('Next stopped during Round 9 integration startup');
    try { if ((await rawFetch(base + '/api/auth')).ok) return; } catch {}
    await wait(100);
  }
  throw new Error('Next readiness timeout');
}
async function start(appPort, mockPort, configured) {
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
    GLPI_API_URL: configured ? `http://127.0.0.1:${mockPort}/apirest.php` : '',
    GLPI_APP_TOKEN: configured ? 'mock-app-token' : '',
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
  if (cookie && !invalidateCreate) headers.set('Cookie', cookie);
  if (String(init.method || 'GET').toUpperCase() === 'POST') headers.set('Origin', base);
  const body = typeof init.body === 'string' ? (() => { try { return JSON.parse(init.body); } catch { return null; } })() : null;
  const isCreate = target.pathname === '/api/glpi' && body?.action === 'createTicket';
  if (isCreate) createBodies.push({ ...body });
  const response = await rawFetch(target, { ...init, headers });
  if (isCreate && invalidateCreate) {
    invalidateCreate = false;
    return response;
  }
  if (isCreate && dropCreate) {
    dropCreate = false;
    await response.arrayBuffer();
    throw new TypeError('browser response lost after mock Ticket acceptance');
  }
  return response;
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
async function open(root) {
  click(button('Nouveau ticket GLPI'));
  await settle(180);
  return root;
}
async function submit() {
  const form = document.querySelector('form.quick-form');
  assert.ok(form, document.body.textContent);
  act(() => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  await settle(350);
}
async function mount(memberId) {
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(NewGlpiTicket, { clients: [globalThis.round9Client], memberId, onCreated: () => {} })); await wait(80); });
  return root;
}
async function unmount(root) { await act(async () => { root.unmount(); await wait(20); }); document.getElementById('root').innerHTML = ''; }

try {
  const appPort = await port();
  const mockPort = await port();
  mock = await mockGlpi(mockPort);
  appChild = await start(appPort, mockPort, true);
  await api('admin', { action: 'setup', name: 'Round 9 admin', email: 'round9-admin@example.test', password: 'Round9-Admin-Password!', token: setupToken });
  await api('admin', { action: 'account', name: 'Round 9 Alice', email: 'round9-alice@example.test', password: 'Round9-Temporary-Password!' });
  await api('alice', { action: 'login', login: 'round9-alice@example.test', password: 'Round9-Temporary-Password!' });
  await api('alice', { action: 'password', current: 'Round9-Temporary-Password!', password: 'Round9-Alice-Password!' });
  let state = await api('admin', null, '/api/time');
  let client = state.clients.find(item => item.name === 'Round 9 client');
  if (!client) { await api('admin', { action: 'client', name: 'Round 9 client' }, '/api/time'); state = await api('admin', null, '/api/time'); client = state.clients.find(item => item.name === 'Round 9 client'); }
  await api('admin', { action: 'clientGlpi', id: client.id, entity: 4 }, '/api/time');
  globalThis.round9Client = { ...client, glpi_entity_id: 4 };
  await api('alice', { action: 'connect', token: 'alice-test-token' }, '/api/glpi');

  // Configuration disappears after the draft is ready but before reservation.
  // The 409 cannot unlock or generate a new UUID; restore replays exactly the
  // same operation and performs one provider Ticket POST.
  localStorage.clear();
  let root = await mount(state.members.find(item => item.email === 'round9-alice@example.test').id);
  await open(root);
  field('select', client.id); field('input[maxlength="250"]', 'ROUND9 CONFIG409'); field('textarea', 'Configuration restoration keeps this UUID.');
  await settle(220);
  await stop(appChild); appChild = await start(appPort, mockPort, false);
  await submit();
  assert.match(document.body.textContent, /Résultat incertain/);
  const configUuid = createBodies.at(-1).request_id;
  const providerBeforeRestore = mock.calls.filter(call => call.method === 'POST' && call.path === 'Ticket').length;
  assert.equal(providerBeforeRestore, 0, 'configuration 409 occurs before any provider Ticket POST');
  await unmount(root);
  await stop(appChild); appChild = await start(appPort, mockPort, true);
  root = await mount(state.members.find(item => item.email === 'round9-alice@example.test').id);
  await open(root);
  click(button('Récupérer le résultat')); await settle(350);
  assert.match(document.body.textContent, /Ticket créé dans GLPI/);
  assert.equal(createBodies.at(-1).request_id, configUuid);
  assert.equal(mock.calls.filter(call => call.method === 'POST' && call.path === 'Ticket').length, providerBeforeRestore + 1);
  click(button('Utiliser ce ticket')); await settle(250);
  await unmount(root);

  // The distinct capability is issued by the real Next route, then the first
  // submit is a real 401 before reservation. Remount/recovery keeps the new
  // UUID and capability; the old completed operation is never selected.
  await api('alice', null, '/api/glpi?uncertain=1');
  root = await mount(state.members.find(item => item.email === 'round9-alice@example.test').id);
  await open(root);
  field('select', client.id); field('input[maxlength="250"]', 'ROUND9 CONFIG409'); field('textarea', 'Configuration restoration keeps this UUID.');
  await settle(220); await submit();
  assert.match(document.body.textContent, /Nouvelle demande distincte requise/);
  click(button('Commencer une nouvelle demande distincte')); await settle(280);
  field('select', client.id); field('input[maxlength="250"]', 'ROUND9 CONFIG409'); field('textarea', 'Configuration restoration keeps this UUID.');
  await settle(220);
  invalidateCreate = true;
  await submit();
  assert.match(document.body.textContent, /Résultat incertain/);
  const distinctUuid = createBodies.at(-1).request_id;
  const distinctIntent = createBodies.at(-1).distinct_intent;
  assert.ok(distinctIntent && distinctUuid !== configUuid);
  await unmount(root);
  root = await mount(state.members.find(item => item.email === 'round9-alice@example.test').id);
  await open(root); click(button('Récupérer le résultat')); await settle(400);
  assert.match(document.body.textContent, /Ticket créé dans GLPI/);
  assert.equal(createBodies.at(-1).request_id, distinctUuid);
  assert.equal(createBodies.at(-1).distinct_intent, distinctIntent);
  assert.equal(mock.calls.filter(call => call.method === 'POST' && call.path === 'Ticket').length, providerBeforeRestore + 2);
  await unmount(root);
  console.log('Round 9 React → Next → mock integration: config409 restore and distinct401 remount PASS; provider Ticket POSTs=' + (providerBeforeRestore + 2));
} finally {
  if (appChild) await stop(appChild).catch(() => {});
  try { mock?.server.closeAllConnections(); mock?.server.close(); } catch {}
}
