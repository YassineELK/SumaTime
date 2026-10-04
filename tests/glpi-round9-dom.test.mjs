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

const client = { id: 'round9-client', name: 'Round 9 client', active: 1, color: null, glpi_entity_id: 4, hourly_rate_cents: null, onsite_hourly_rate_cents: null };
const clients = [client];
const oldRequest = { request_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', client_id: client.id, title: 'Distinct continuity', description: 'The old operation must never absorb the new one.', type: 1, urgency: 3, category: 0 };
const distinctIntent = { intent_id: 'c'.repeat(64), expiresAt: new Date(Date.now() + 600_000).toISOString() };
let scenario = 'config';
let configBodies = [];
let distinctBodies = [];
let configRecovered = false;
let distinct401 = false;

const operation = payload => ({ payload, createdAt: new Date().toISOString() });
const ticket = (payload, id) => ({ id, title: payload.title, status: 1, entity: 4, url: `http://127.0.0.1:8790/front/ticket.form.php?id=${id}`, client_id: client.id, client: client.name });
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url === '/api/glpi' && init.method === 'POST') {
    const body = JSON.parse(String(init.body));
    if (body.action === 'beginDistinctCreation') return new Response(JSON.stringify(distinctIntent), { status: 200 });
    if (body.action === 'createTicket') {
      if (scenario === 'config') {
        configBodies.push({ ...body });
        if (!configRecovered) {
          configRecovered = true;
          return new Response(JSON.stringify({ error: 'GLPI doit être configuré.', code: 'CONFIG_NOT_READY', terminal: false, retryable: true, preserveOperation: true, uncertain: true }), { status: 409 });
        }
        return new Response(JSON.stringify({ ticket: ticket(body, 9101), operation: operation(body) }), { status: 200 });
      }
      distinctBodies.push({ ...body });
      if (!distinct401) {
        distinct401 = true;
        return new Response(JSON.stringify({ error: 'Reconnectez-vous.', code: 'AUTH_REQUIRED', terminal: false, retryable: true, preserveOperation: true }), { status: 401 });
      }
      return new Response(JSON.stringify({ ticket: ticket(body, 9102), operation: operation(body) }), { status: 200 });
    }
    throw new Error(`unexpected mutation ${body.action}`);
  }
  if (url === '/api/glpi?uncertain=1') {
    return new Response(JSON.stringify(scenario === 'distinct' ? { requests: [operation(oldRequest)], blocked: false } : { requests: [], blocked: false }), { status: 200 });
  }
  if (url.startsWith('/api/glpi?createOptions')) return new Response(JSON.stringify({ categories: [{ id: 1, name: 'Assistance' }], limited: false }), { status: 200 });
  if (url === '/api/glpi') return new Response(JSON.stringify({ configured: true, connected: true, canCreate: true, web: 'http://127.0.0.1:8790' }), { status: 200 });
  throw new Error(`unexpected fetch ${url}`);
};

function wait(milliseconds = 0) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
async function settle(milliseconds = 20) { await act(async () => { await wait(milliseconds); }); }
function click(value) { assert.ok(value); act(() => { value.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); }); }
function button(label) { return [...document.querySelectorAll('button')].find(value => value.textContent?.includes(label)); }
function setField(selector, value) {
  const field = document.querySelector(selector);
  assert.ok(field, `missing ${selector}: ${document.body.textContent}`);
  const setter = Object.getOwnPropertyDescriptor(field.constructor.prototype, 'value')?.set;
  act(() => {
    setter?.call(field, value);
    field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    field.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  });
}
async function openForm() {
  click(button('Nouveau ticket GLPI'));
  await settle(30);
}
async function submitForm() {
  const form = document.querySelector('form.quick-form');
  assert.ok(form, document.body.textContent);
  act(() => { form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
  await settle(35);
}
function render(root, memberId) { root.render(React.createElement(NewGlpiTicket, { clients, memberId, onCreated: () => {} })); }

test('config 409 is fail-closed and restores the same UUID with one creation', async () => {
  scenario = 'config'; configBodies = []; configRecovered = false;
  localStorage.clear();
  const rootElement = document.getElementById('root');
  const root = createRoot(rootElement);
  await act(async () => { render(root, 'config-member'); await wait(20); });
  await openForm();
  setField('select', client.id); setField('input[maxlength="250"]', 'Config unavailable'); setField('textarea', 'The draft must remain locked.');
  await settle(25);
  await submitForm();
  assert.match(document.body.textContent, /Résultat incertain/);
  const first = configBodies[0];
  assert.ok(first?.request_id);
  assert.equal(first.distinct_intent, undefined);
  await act(async () => { root.unmount(); await wait(5); });
  rootElement.innerHTML = '';
  const remounted = createRoot(rootElement);
  await act(async () => { render(remounted, 'config-member'); await wait(25); });
  await openForm();
  assert.match(document.body.textContent, /Résultat incertain/);
  click(button('Récupérer le résultat'));
  await settle(40);
  assert.match(document.body.textContent, /Ticket créé dans GLPI/);
  assert.equal(configBodies.length, 2);
  assert.equal(configBodies[1].request_id, first.request_id, 'config recovery must reuse the original UUID');
  await act(async () => { remounted.unmount(); await wait(5); });
});

test('distinct capability survives 401, remount and recovery without aliasing the old operation', async () => {
  scenario = 'distinct'; distinctBodies = []; distinct401 = false;
  localStorage.clear();
  assert.deepEqual(savePendingGlpiRequest(oldRequest, undefined, 'distinct-member'), { ok: true });
  const rootElement = document.getElementById('root');
  const root = createRoot(rootElement);
  await act(async () => { render(root, 'distinct-member'); await wait(25); });
  await openForm();
  click(button('Commencer une nouvelle demande distincte'));
  await settle(35);
  const distinctForm = document.querySelector('form.quick-form');
  assert.ok(distinctForm);
  setField('select', client.id); setField('input[maxlength="250"]', oldRequest.title); setField('textarea', oldRequest.description);
  await settle(25);
  await submitForm();
  assert.match(document.body.textContent, /Résultat incertain/);
  assert.equal(distinctBodies.length, 1);
  const first = distinctBodies[0];
  assert.equal(first.distinct_intent, distinctIntent.intent_id);
  assert.notEqual(first.request_id, oldRequest.request_id);
  await act(async () => { root.unmount(); await wait(5); });
  rootElement.innerHTML = '';
  const remounted = createRoot(rootElement);
  await act(async () => { render(remounted, 'distinct-member'); await wait(30); });
  await openForm();
  assert.match(document.body.textContent, /Résultat incertain/);
  click(button('Récupérer le résultat'));
  await settle(45);
  assert.match(document.body.textContent, /Ticket créé dans GLPI/);
  assert.equal(distinctBodies.length, 2);
  assert.equal(distinctBodies[1].request_id, first.request_id, 'recovery must retain the distinct UUID');
  assert.equal(distinctBodies[1].distinct_intent, first.distinct_intent, 'recovery must retain the same capability');
  assert.notEqual(distinctBodies[1].request_id, oldRequest.request_id, 'new distinct draft must never alias the old uncertainty');
  await act(async () => { remounted.unmount(); await wait(5); });
});
