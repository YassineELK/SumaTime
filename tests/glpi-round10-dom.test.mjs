import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { savePendingGlpiRequest } from '../lib/glpi-draft.ts';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:5174/' });
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

const client = { id: 'round10-client', name: 'Round 10 client', active: 1, color: null, glpi_entity_id: 4, hourly_rate_cents: null, onsite_hourly_rate_cents: null };
const draft = { request_id: '99999999-9999-9999-9999-999999999999', client_id: client.id, title: 'Expired distinct draft', description: 'Renew this exact draft, never replay the old ticket.', type: 1, urgency: 3, category: 0 };
const expired = { intent_id: 'd'.repeat(64), expiresAt: new Date(Date.now() - 1).toISOString() };
const renewed = { intent_id: 'e'.repeat(64), expiresAt: new Date(Date.now() + 600_000).toISOString() };
const beginBodies = [];
const createBodies = [];
let created = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url === '/api/glpi' && init.method === 'POST') {
    const body = JSON.parse(String(init.body));
    if (body.action === 'beginDistinctCreation') {
      beginBodies.push(body);
      return new Response(JSON.stringify(renewed), { status: 200 });
    }
    if (body.action === 'createTicket') {
      createBodies.push(body);
      if (body.distinct_intent !== renewed.intent_id) return new Response(JSON.stringify({ error: 'Intent expired', code: 'INTENT_EXPIRED', terminal: false, retryable: false, preserveOperation: true }), { status: 409 });
      created += 1;
      return new Response(JSON.stringify({ ticket: { id: 9910, title: body.title, status: 1, entity: 4, url: 'http://127.0.0.1:8790/front/ticket.form.php?id=9910', client_id: client.id, client: client.name }, operation: { payload: body, createdAt: new Date().toISOString() } }), { status: 200 });
    }
  }
  if (url === '/api/glpi?uncertain=1') return new Response(JSON.stringify({ requests: [], blocked: false }), { status: 200 });
  if (url.startsWith('/api/glpi?createOptions')) return new Response(JSON.stringify({ categories: [{ id: 1, name: 'Assistance' }], limited: false }), { status: 200 });
  if (url === '/api/glpi') return new Response(JSON.stringify({ configured: true, connected: true, canCreate: true, web: 'http://127.0.0.1:8790' }), { status: 200 });
  throw new Error(`unexpected fetch ${url}`);
};

function wait(milliseconds = 0) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
async function settle(milliseconds = 20) { await act(async () => { await wait(milliseconds); }); }
function click(value) { assert.ok(value, `missing button: ${document.body.textContent}`); act(() => value.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))); }
function button(label) { return [...document.querySelectorAll('button')].find(value => value.textContent?.includes(label)); }

test('expired distinct draft survives remount and unavailable storage, then renews same UUID once', async () => {
  localStorage.clear(); beginBodies.length = 0; createBodies.length = 0; created = 0;
  assert.deepEqual(savePendingGlpiRequest(draft, undefined, 'round10-member', expired, { preserveExpiredCapability: true }), { ok: true });
  const rootElement = document.getElementById('root');
  const root = createRoot(rootElement);
  await act(async () => { root.render(React.createElement(NewGlpiTicket, { clients: [client], memberId: 'round10-member', onCreated: () => {} })); await wait(30); });
  await act(async () => { root.unmount(); await wait(5); });
  rootElement.innerHTML = '';
  const remounted = createRoot(rootElement);
  await act(async () => { remounted.render(React.createElement(NewGlpiTicket, { clients: [client], memberId: 'round10-member', onCreated: () => {} })); await wait(30); });
  click(button('Nouveau ticket GLPI')); await settle(30);
  assert.match(document.body.textContent, /Intention distincte expirée/);

  const storage = globalThis.localStorage;
  const original = { getItem: storage.getItem, setItem: storage.setItem, removeItem: storage.removeItem };
  Object.defineProperty(storage, 'getItem', { configurable: true, value() { throw new Error('storage unavailable'); } });
  Object.defineProperty(storage, 'setItem', { configurable: true, value() { throw new Error('storage unavailable'); } });
  Object.defineProperty(storage, 'removeItem', { configurable: true, value() { throw new Error('storage unavailable'); } });
  click(button('Renouveler l’intention distincte')); await settle(35);
  assert.equal(beginBodies.length, 1);
  assert.equal(beginBodies[0].draft_request_id, draft.request_id, 'renewal must remain bound to the same draft UUID');
  const form = document.querySelector('form.quick-form');
  assert.ok(form);
  act(() => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  await settle(50);
  assert.match(document.body.textContent, /Ticket créé dans GLPI/);
  assert.equal(createBodies.length, 1);
  assert.equal(createBodies[0].request_id, draft.request_id);
  assert.equal(createBodies[0].distinct_intent, renewed.intent_id);
  assert.equal(created, 1, 'renewal has one provider-equivalent creation only');
  Object.defineProperty(storage, 'getItem', { configurable: true, value: original.getItem });
  Object.defineProperty(storage, 'setItem', { configurable: true, value: original.setItem });
  Object.defineProperty(storage, 'removeItem', { configurable: true, value: original.removeItem });
  await act(async () => { remounted.unmount(); await wait(5); });
});
