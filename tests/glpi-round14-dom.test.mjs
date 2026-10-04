import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { glpiAcknowledgedStorageKey, glpiUncertainStorageKey, isGlpiCreationAcknowledged } from '../lib/glpi-draft.ts';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:5178/' });
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

const memberId = 'round14-dom-member';
const client = { id: 'round14-dom-client', name: 'Round 14 DOM client', active: 1, color: null, glpi_entity_id: 4, hourly_rate_cents: null, onsite_hourly_rate_cents: null };
const clients = [client];
let createdOperation = null;
let createCalls = 0;
let ackCalls = 0;
let ackCommitted = false;
let nextTicketId = 14_100;
let callbacks = 0;

globalThis.fetch = async (input, init = {}) => {
  const target = new URL(String(input), 'http://127.0.0.1:5178');
  if (target.pathname === '/api/glpi' && init.method === 'POST') {
    const body = JSON.parse(String(init.body));
    if (body.action === 'createTicket') {
      createCalls += 1;
      const payload = { request_id: body.request_id, client_id: body.client_id, title: body.title, description: body.description, type: body.type, urgency: body.urgency, category: body.category };
      if (!createdOperation) {
        const ticket = { id: ++nextTicketId, title: payload.title, status: 1, entity: 4, url: `http://127.0.0.1:8796/front/ticket.form.php?id=${nextTicketId}`, client_id: client.id, client: client.name };
        createdOperation = { payload, createdAt: new Date().toISOString(), ticket };
      } else {
        assert.deepEqual(payload, createdOperation.payload, 'cold recovery reuses the exact UUID and canonical payload');
      }
      return new Response(JSON.stringify({ ticket: createdOperation.ticket, operation: createdOperation }), { status: 200 });
    }
    if (body.action === 'acknowledgeCreation') {
      ackCalls += 1;
      ackCommitted = true;
      assert.equal(body.request_id, createdOperation?.payload.request_id);
      assert.equal(body.ticket_id, createdOperation?.ticket.id);
      return new Response(JSON.stringify({ ok: true, ack_scope: 'http://127.0.0.1:8796/apirest.php' }), { status: 200 });
    }
    throw new Error(`Unexpected POST action ${body.action}`);
  }
  if (target.pathname === '/api/glpi' && target.searchParams.has('uncertain')) {
    if (!createdOperation) return new Response(JSON.stringify({ requests: [], recoverable: [], blocked: false }), { status: 200 });
    if (target.searchParams.get('recover') === '1') return new Response(JSON.stringify({ requests: [], recoverable: [createdOperation], ack_scope: 'http://127.0.0.1:8796/apirest.php', blocked: false }), { status: 200 });
    return new Response(JSON.stringify({ requests: ackCommitted ? [] : [createdOperation], blocked: false }), { status: 200 });
  }
  if (target.pathname === '/api/glpi' && target.searchParams.has('createOptions')) return new Response(JSON.stringify({ categories: [{ id: 1, name: 'Assistance' }], limited: false }), { status: 200 });
  if (target.pathname === '/api/glpi') return new Response(JSON.stringify({ configured: true, connected: true, canCreate: true, web: 'http://127.0.0.1:8796' }), { status: 200 });
  throw new Error(`Unexpected fetch ${target}`);
};

function wait(milliseconds = 0) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
async function settle(milliseconds = 20) { await act(async () => { await wait(milliseconds); }); }
function button(label) { return [...document.querySelectorAll('button')].find(value => value.textContent?.includes(label)); }
function setField(field, value) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(field.constructor.prototype, 'value')?.set;
    setter?.call(field, value);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    field.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
}
async function openNew() {
  const trigger = button('Nouveau ticket GLPI');
  assert.ok(trigger);
  await act(async () => { trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(30); });
}
async function fillAndSubmit(title) {
  await openNew();
  const form = document.querySelector('form.quick-form');
  assert.ok(form, document.body.textContent);
  setField(form.querySelector('select'), client.id);
  setField(form.querySelector('input[maxlength="250"]'), title);
  setField(form.querySelector('textarea'), 'Round 14 durable ACK authority');
  await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await wait(30); });
  assert.match(document.body.textContent, /Ticket créé dans GLPI/);
}
function mount() {
  const container = document.getElementById('root');
  const root = createRoot(container);
  act(() => { root.render(React.createElement(NewGlpiTicket, { clients, memberId, onCreated: () => { callbacks += 1; } })); });
  return { root, container };
}
async function unmount(mounted) {
  await act(async () => { mounted.root.unmount(); await wait(0); });
  mounted.container.innerHTML = '';
}
function clearState() {
  dom.window.localStorage.clear();
  dom.window.sessionStorage.clear();
  createdOperation = null;
  createCalls = 0;
  ackCalls = 0;
  ackCommitted = false;
  callbacks = 0;
}

test('quota ACK never falls back to sessionStorage; explicit cold recovery later ACKs once', async () => {
  clearState();
  let mounted = mount();
  await settle(30);
  await fillAndSubmit('Round 14 quota ACK');

  const storagePrototype = Object.getPrototypeOf(dom.window.localStorage);
  const originalSetItem = storagePrototype.setItem;
  const acknowledgementKey = glpiAcknowledgedStorageKey(memberId);
  storagePrototype.setItem = function (key, value) {
      if (key === acknowledgementKey) throw Object.assign(new Error('simulated quota'), { name: 'QuotaExceededError' });
      return originalSetItem.call(this, key, value);
  };
  assert.throws(() => dom.window.localStorage.setItem(acknowledgementKey, '{}'), /simulated quota/);
  await act(async () => { button('Utiliser ce ticket').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(30); });
  assert.equal(ackCalls, 1, 'the server ACK is committed exactly once before the durable marker attempt');
  assert.equal(callbacks, 0, 'a non-durable ACK cannot fire the final callback');
  assert.equal(dom.window.sessionStorage.getItem(acknowledgementKey), null, 'sessionStorage is never accepted as the ACK authority');
  assert.equal(dom.window.localStorage.getItem(acknowledgementKey), null, 'the failed durable marker is absent');
  assert.ok(dom.window.localStorage.getItem(glpiUncertainStorageKey(memberId)), 'UUID/payload remains explicitly recoverable');
  await unmount(mounted);

  // A new page has a fresh sessionStorage. The durable store becomes writable
  // again, so the user can recover the exact server result and finish ACK.
  storagePrototype.setItem = originalSetItem;
  dom.window.sessionStorage.clear();
  mounted = mount();
  await settle(30);
  await openNew();
  assert.match(document.body.textContent, /Résultat incertain/);
  await act(async () => { button('Récupérer le résultat').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(30); });
  assert.match(document.body.textContent, /Ticket créé dans GLPI/);
  assert.equal(createCalls, 2, 'cold recovery reuses the operation identity; it never sends a second provider Ticket POST');
  await act(async () => { button('Utiliser ce ticket').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(30); });
  assert.equal(ackCalls, 2, 'the committed ACK can be safely retried');
  assert.equal(callbacks, 1, 'the callback fires exactly once after durable ACK');
  assert.equal(isGlpiCreationAcknowledged(memberId, createdOperation.payload.request_id, 'http://127.0.0.1:8796/apirest.php'), true);
  assert.equal(dom.window.localStorage.getItem(glpiUncertainStorageKey(memberId)), null);
  await unmount(mounted);
});
