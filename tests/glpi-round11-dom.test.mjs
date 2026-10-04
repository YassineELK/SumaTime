import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:5174/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLAnchorElement', 'Node', 'NodeFilter', 'Element', 'DocumentFragment', 'MutationObserver', 'getComputedStyle', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'FocusEvent']) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: { getItem() { throw new Error('storage unavailable'); }, setItem() { throw new Error('storage unavailable'); }, removeItem() { throw new Error('storage unavailable'); } } });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = id => clearTimeout(id);
globalThis.PointerEvent = dom.window.MouseEvent;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value: { ...globalThis.crypto, randomUUID: () => 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee' } });
const { createRoot } = await import('react-dom/client');
const { default: NewGlpiTicket } = await import('../app/new-glpi-ticket.tsx');

const client = { id: 'round11-dom-client', name: 'Round 11 client', active: 1, color: null, glpi_entity_id: 4, hourly_rate_cents: null, onsite_hourly_rate_cents: null };
const draft = { request_id: '11111111-1111-1111-1111-111111111111', client_id: client.id, title: 'Server authoritative draft', description: 'Cold page must use this exact draft.', type: 1, urgency: 3, category: 0 };
const old = { payload: { ...draft, request_id: '22222222-2222-2222-2222-222222222222', title: 'Old ticket must never appear' }, createdAt: new Date().toISOString(), ticket: { id: 120, title: 'Old ticket must never appear', status: 1, entity: 4, url: 'http://127.0.0.1:8790/front/ticket.form.php?id=120', client_id: client.id, client: client.name } };
const expired = { intent_id: 'a'.repeat(64), expiresAt: new Date(Date.now() - 1).toISOString() };
const renewed = { intent_id: 'b'.repeat(64), expiresAt: new Date(Date.now() + 600000).toISOString(), draft_request_id: draft.request_id, generation: 1, state: 'active' };
const beginBodies = [];
const createBodies = [];
let serverIntent = expired;
let serverOperation = null;

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url === '/api/glpi' && init.method === 'POST') {
    const body = JSON.parse(String(init.body));
    if (body.action === 'beginDistinctCreation') { beginBodies.push(body); serverIntent = renewed; return new Response(JSON.stringify(renewed), { status: 200 }); }
    if (body.action === 'createTicket') {
      createBodies.push(body);
      serverOperation = { payload: { ...draft }, createdAt: new Date().toISOString(), ticket: { id: 121, title: body.title, status: 1, entity: 4, url: 'http://127.0.0.1:8790/front/ticket.form.php?id=121', client_id: client.id, client: client.name } };
      return new Response(JSON.stringify({ ticket: serverOperation.ticket, operation: serverOperation }), { status: 200 });
    }
  }
  if (url === '/api/glpi?uncertain=1' || url === '/api/glpi?uncertain=1&recover=1') return new Response(JSON.stringify({ requests: [old], recoverable: [], distinctDrafts: [{ draft_request_id: draft.request_id, intent_id: serverIntent.intent_id, expiresAt: serverIntent.expiresAt, createdAt: new Date().toISOString(), generation: serverIntent === expired ? 0 : 1, payload: draft, ...(serverOperation ? { operation: serverOperation } : {}) }], blocked: false }), { status: 200 });
  if (url.startsWith('/api/glpi?createOptions')) return new Response(JSON.stringify({ categories: [], limited: false }), { status: 200 });
  if (url === '/api/glpi') return new Response(JSON.stringify({ configured: true, connected: true, canCreate: true, web: 'http://127.0.0.1:8790' }), { status: 200 });
  throw new Error('unexpected fetch ' + url);
};

function wait(milliseconds = 0) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
async function settle(milliseconds = 30) { await act(async () => { await wait(milliseconds); }); }
function button(label) { return [...document.querySelectorAll('button')].find(value => value.textContent?.includes(label)); }
function click(value) { assert.ok(value, document.body.textContent); act(() => value.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }))); }

test('cold UI adopts the server draft and never displays the older fingerprint result', async () => {
  const rootElement = document.getElementById('root');
  const root = createRoot(rootElement);
  await act(async () => { root.render(React.createElement(NewGlpiTicket, { clients: [client], memberId: 'round11-alice', onCreated: () => {} })); await wait(60); });
  click(button('Nouveau ticket GLPI'));
  await settle(60);
  assert.equal(document.querySelector('input[maxlength="250"]')?.value, draft.title);
  assert.doesNotMatch(document.body.textContent, /Old ticket must never appear|GLPI-120/);
  click(button('Renouveler l’intention distincte'));
  await settle(60);
  assert.equal(beginBodies[0].draft_request_id, draft.request_id);
  assert.equal(beginBodies[0].draft_payload.request_id, draft.request_id);
  const form = document.querySelector('form.quick-form');
  assert.ok(form);
  act(() => form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
  await settle(80);
  assert.equal(createBodies.length, 1, document.body.textContent);
  assert.match(document.body.textContent, /Ticket créé dans GLPI/);
  assert.equal(createBodies.length, 1);
  assert.equal(createBodies[0].request_id, draft.request_id);
  assert.equal(createBodies[0].distinct_intent, renewed.intent_id);
  await act(async () => { root.unmount(); await wait(5); });
});
