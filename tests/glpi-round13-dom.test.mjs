import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { glpiAcknowledgedStorageKey, glpiUncertainStorageKey, isGlpiCreationAcknowledged } from '../lib/glpi-draft.ts';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:5175/' });
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

const memberId = 'round13-dom-member';
const client = { id: 'round13-dom-client', name: 'Round 13 DOM client', active: 1, color: null, glpi_entity_id: 4, hourly_rate_cents: null, onsite_hourly_rate_cents: null };
const clients = [client];
let createdOperation = null;
let createCalls = 0;
let ackCalls = 0;
let ackCommitted = false;
let dropAckResponse = false;
let nextTicketId = 13_100;
let callbacks = 0;

globalThis.fetch = async (input, init = {}) => {
  const target = new URL(String(input), 'http://127.0.0.1:5175');
  if (target.pathname === '/api/glpi' && init.method === 'POST') {
    const body = JSON.parse(String(init.body));
    if (body.action === 'createTicket') {
      createCalls += 1;
      const payload = { request_id: body.request_id, client_id: body.client_id, title: body.title, description: body.description, type: body.type, urgency: body.urgency, category: body.category };
      if (!createdOperation) {
        const ticket = { id: ++nextTicketId, title: payload.title, status: 1, entity: 4, url: `http://127.0.0.1:8795/front/ticket.form.php?id=${nextTicketId}`, client_id: client.id, client: client.name };
        createdOperation = { payload, createdAt: new Date().toISOString(), ticket };
      } else assert.deepEqual(payload, createdOperation.payload, 'recovery replays the exact UUID and canonical payload');
      return new Response(JSON.stringify({ ticket: createdOperation.ticket, operation: createdOperation }), { status: 200 });
    }
    if (body.action === 'acknowledgeCreation') {
      ackCalls += 1;
      ackCommitted = true;
      assert.equal(body.request_id, createdOperation?.payload.request_id);
      assert.equal(body.ticket_id, createdOperation?.ticket.id);
      if (dropAckResponse) {
        dropAckResponse = false;
        throw new TypeError('ACK response lost after server commit');
      }
      return new Response(JSON.stringify({ ok: true, ack_scope: 'http://127.0.0.1:8795/apirest.php' }), { status: 200 });
    }
    throw new Error('Unexpected POST action ' + body.action);
  }
  if (target.pathname === '/api/glpi' && target.searchParams.has('uncertain')) {
    if (!createdOperation) return new Response(JSON.stringify({ requests: [], recoverable: [], blocked: false }), { status: 200 });
    if (target.searchParams.get('recover') === '1') return new Response(JSON.stringify({ requests: [], recoverable: [createdOperation], ack_scope: 'http://127.0.0.1:8795/apirest.php', blocked: false }), { status: 200 });
    return new Response(JSON.stringify({ requests: ackCommitted ? [] : [createdOperation], blocked: false }), { status: 200 });
  }
  if (target.pathname === '/api/glpi' && target.searchParams.has('createOptions')) return new Response(JSON.stringify({ categories: [{ id: 1, name: 'Assistance' }], limited: false }), { status: 200 });
  if (target.pathname === '/api/glpi') return new Response(JSON.stringify({ configured: true, connected: true, canCreate: true, web: 'http://127.0.0.1:8795' }), { status: 200 });
  throw new Error('Unexpected fetch ' + target);
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
  setField(form.querySelector('textarea'), 'Round 13 exact ACK identity');
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
  dropAckResponse = false;
}

test('ACK success is durable across a cold page and a consumed result is not auto-reintroduced', async () => {
  clearState();
  let mounted = mount();
  await settle(30);
  await fillAndSubmit('ACK confirmed durable');
  await act(async () => { button('Utiliser ce ticket').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(30); });
  assert.equal(ackCalls, 1);
  assert.equal(callbacks, 1);
  assert.ok(dom.window.localStorage.getItem(glpiAcknowledgedStorageKey(memberId)), 'successful ACK writes a durable client confirmation');
  assert.equal(isGlpiCreationAcknowledged(memberId, createdOperation.payload.request_id, 'http://127.0.0.1:8795/apirest.php'), true);
  assert.equal(isGlpiCreationAcknowledged(memberId, createdOperation.payload.request_id, 'http://127.0.0.1:8813/apirest.php'), false, 'an ACK marker is API-scoped');
  assert.equal(isGlpiCreationAcknowledged('round13-other-member', createdOperation.payload.request_id), false, 'an ACK marker is member-scoped');
  assert.equal(dom.window.localStorage.getItem(glpiUncertainStorageKey(memberId)), null, 'pending UUID is removed only after durable confirmation');
  await unmount(mounted);

  mounted = mount();
  await settle(30);
  await openNew();
  assert.ok(document.querySelector('form.quick-form'), document.body.textContent);
  assert.doesNotMatch(document.body.textContent, /Ticket créé dans GLPI/);
  assert.equal(createCalls, 1, 'a true cold page does not create or recover a confirmed result');
  await unmount(mounted);
});

test('a lost ACK response keeps the UUID and replays the exact result once after a cold remount', async () => {
  clearState();
  let mounted = mount();
  await settle(30);
  await fillAndSubmit('ACK response lost');
  dropAckResponse = true;
  await act(async () => { button('Utiliser ce ticket').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(30); });
  assert.equal(ackCalls, 1);
  assert.equal(callbacks, 0, 'a lost ACK response cannot fire the completion callback');
  assert.equal(dom.window.localStorage.getItem(glpiAcknowledgedStorageKey(memberId)), null, 'no confirmed marker is written when the response is lost');
  assert.ok(dom.window.localStorage.getItem(glpiUncertainStorageKey(memberId)), 'the exact UUID remains for cold recovery');
  await unmount(mounted);

  mounted = mount();
  await settle(30);
  await openNew();
  assert.match(document.body.textContent, /Résultat incertain/);
  await act(async () => { button('Récupérer le résultat').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(30); });
  assert.match(document.body.textContent, /Ticket créé dans GLPI/);
  assert.equal(createCalls, 2, 'the recovery POST reuses the same operation identity, not a provider POST');
  await act(async () => { button('Utiliser ce ticket').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(30); });
  assert.equal(ackCalls, 2, 'the ACK endpoint is safely replayed');
  assert.equal(callbacks, 1);
  assert.ok(dom.window.localStorage.getItem(glpiAcknowledgedStorageKey(memberId)));
  await unmount(mounted);
});
