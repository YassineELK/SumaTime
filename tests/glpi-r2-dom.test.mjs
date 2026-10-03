import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root-a"></div><div id="root-b"></div></body></html>', { url: 'http://127.0.0.1:5174/' });
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

const client = { id: 'client-r2', name: 'Client R2', active: 1, color: null, glpi_entity_id: 4, hourly_rate_cents: null, onsite_hourly_rate_cents: null };
const clients = [client];
const accepted = [];
let pending = null;
let creates = 0;
let completedOnLoss = false;
let completedVisible = false;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url === '/api/glpi' && init.method === 'POST') {
    const body = JSON.parse(String(init.body));
    if (body.action === 'acknowledgeCreation') return new Response(JSON.stringify({ ok: true }), { status: 200 });
    assert.equal(body.action, 'createTicket');
    const value = { request_id: body.request_id, client_id: body.client_id, title: body.title, description: body.description, type: body.type, urgency: body.urgency, category: body.category };
    if (!accepted.length) {
      accepted.push(value);
      pending = completedOnLoss ? { ...value, ticket: { id: 9100, title: value.title, status: 1, entity: 4, url: 'http://127.0.0.1:8792/front/ticket.form.php?id=9100', client_id: client.id, client: client.name } } : value;
      creates += 1;
      throw new TypeError('response lost after mock GLPI accepted Ticket POST');
    }
    assert.deepEqual(value, accepted[0], 'same member reconciliation must post the exact canonical request');
    pending = null;
    return new Response(JSON.stringify({ ticket: { id: 9100, title: value.title, status: 1, entity: 4, url: 'http://127.0.0.1:8792/front/ticket.form.php?id=9100', client_id: client.id, client: client.name } }), { status: 200 });
  }
  if (url === '/api/glpi?uncertain=1') {
    const request = pending && (!pending.ticket || completedVisible) ? (() => { const { ticket, ...payload } = pending; return { payload, ...(ticket ? { ticket } : {}), createdAt: new Date().toISOString() }; })() : null;
    return new Response(JSON.stringify({ requests: request ? [request] : [], blocked: false }), { status: 200 });
  }
  if (url === '/api/glpi') return new Response(JSON.stringify({ configured: true, connected: true, canCreate: true, web: 'http://127.0.0.1:8792' }), { status: 200 });
  if (url.startsWith('/api/glpi?createOptions')) return new Response(JSON.stringify({ categories: [{ id: 1, name: 'Assistance' }], limited: false }), { status: 200 });
  throw new Error(`Unexpected fetch ${url}`);
};

function wait(milliseconds = 0) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
async function settle(milliseconds = 10) { await act(async () => { await wait(milliseconds); }); }
function click(button) { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); }
function setField(field, value) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(field.constructor.prototype, 'value')?.set;
    setter?.call(field, value);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    field.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
}
function button(label) { return [...document.querySelectorAll('button')].find(value => value.textContent?.includes(label)); }
const roots = new WeakMap();
function create(element, container) {
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  act(() => { root.render(element); });
  return root;
}
function ticket(memberId = 'alice-member') { return React.createElement(NewGlpiTicket, { clients, memberId, onCreated: () => {} }); }

test('quota failure remount consults the member-scoped Next API and reconciles one mock Ticket POST', { concurrency: false }, async () => {
  const blockedStorage = { getItem: () => null, setItem: () => { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); }, removeItem: () => {} };
  completedOnLoss = true;
  completedVisible = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: blockedStorage });
  Object.defineProperty(dom.window, 'localStorage', { configurable: true, writable: true, value: blockedStorage });
  const container = document.getElementById('root-a');
  let root = create(ticket(), container);
  await settle(20);
  await act(async () => { click(button('Nouveau ticket GLPI')); await wait(20); });
  const form = document.querySelector('form.quick-form');
  assert.ok(form);
  setField(form.querySelector('select'), client.id);
  setField(form.querySelector('input[maxlength="250"]'), 'Quota request');
  setField(form.querySelector('textarea'), 'Server-authoritative description');
  await act(async () => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await wait(20); });
  assert.match(document.body.textContent, /Résultat incertain/);
  assert.equal(creates, 1);
  await act(async () => { root.render(null); await wait(0); });
  completedVisible = true;
  root = create(ticket(), container);
  await settle(25);
  await act(async () => { click(button('Nouveau ticket GLPI')); await wait(20); });
  assert.match(document.body.textContent, /Résultat récupéré depuis le serveur membre-scopé/);
  assert.match(document.body.textContent, /Ticket créé dans GLPI/);
  assert.equal(creates, 1, 'remount and reconciliation must not emit a second mock Ticket creation');
  await act(async () => { root.render(null); await wait(0); });
});

test('two mounted creators receive one member-scoped uncertain operation immediately', { concurrency: false }, async () => {
  accepted.length = 0;
  pending = null;
  creates = 0;
  completedOnLoss = false;
  completedVisible = false;
  const a = document.getElementById('root-a');
  const b = document.getElementById('root-b');
  const rootA = create(ticket(), a);
  const rootB = create(ticket(), b);
  await settle(20);
  const buttons = [...document.querySelectorAll('button')].filter(value => value.textContent?.includes('Nouveau ticket GLPI'));
  assert.equal(buttons.length, 2);
  await act(async () => { click(buttons[1]); await wait(15); });
  const forms = [...document.querySelectorAll('form.quick-form')];
  const second = forms.at(-1);
  assert.ok(second);
  setField(second.querySelector('select'), client.id);
  setField(second.querySelector('input[maxlength="250"]'), 'Mounted duplicate guard');
  setField(second.querySelector('textarea'), 'Only one creator may own this operation');
  await act(async () => { second.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await wait(25); });
  assert.equal(creates, 1);
  await act(async () => { click(buttons[0]); await wait(20); });
  assert.match(document.body.textContent, /Résultat incertain/);
  assert.equal([...document.querySelectorAll('button')].filter(value => value.textContent?.includes('Récupérer le résultat')).length, 2);
  await act(async () => { rootA.render(null); rootB.render(null); await wait(0); });
});
