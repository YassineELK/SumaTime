import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { GLPI_UNCERTAIN_STORAGE_KEY } from '../lib/glpi-draft.ts';

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

const client = { id: 'client-glpi', name: 'Client GLPI', active: 1, color: null, glpi_entity_id: 4, hourly_rate_cents: null, onsite_hourly_rate_cents: null };
const calls = [];
let acceptedPayload = null;
let glpiTicketCreates = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  calls.push({ url, init });
  if (url === '/api/glpi' && init.method === 'POST') {
    const body = JSON.parse(String(init.body));
    if (body.action !== 'createTicket') throw new Error('unexpected mutation');
    const payload = { request_id: body.request_id, client_id: body.client_id, title: body.title, description: body.description, type: body.type, urgency: body.urgency, category: body.category };
    if (!acceptedPayload) {
      acceptedPayload = payload;
      glpiTicketCreates += 1;
      throw new TypeError('browser response lost after GLPI accepted the ticket');
    }
    assert.deepEqual(payload, acceptedPayload, 'reconciliation must reuse the exact UUID and canonical payload');
    return new Response(JSON.stringify({ ticket: { id: 9001, title: payload.title, status: 1, entity: 4, url: 'http://127.0.0.1:8790/front/ticket.form.php?id=9001', client_id: client.id, client: client.name } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url === '/api/glpi?uncertain=1') return new Response(JSON.stringify({ requests: [], blocked: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url === '/api/glpi') return new Response(JSON.stringify({ configured: true, connected: true, canCreate: true, web: 'http://127.0.0.1:8790' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('/api/glpi?createOptions')) return new Response(JSON.stringify({ categories: [{ id: 1, name: 'Assistance' }], limited: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  throw new Error(`Unexpected fetch ${url}`);
};

function wait(milliseconds = 0) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
function button(label) { return [...document.querySelectorAll('button')].find(value => value.textContent?.includes(label)); }
function setField(selector, value) {
  const field = document.querySelector(selector);
  assert.ok(field, `missing field ${selector}; body=${document.body.textContent}`);
  const setter = Object.getOwnPropertyDescriptor(field.constructor.prototype, 'value')?.set;
  setter?.call(field, value);
  field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  field.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}
function click(value) {
  value.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
}

test('uncertain GLPI UI remount reconciles the same request without a second underlying creation', async () => {
  const rootElement = document.getElementById('root');
  const clients = [client];
  const render = root => root.render(React.createElement(NewGlpiTicket, { clients, onCreated: () => {} }));
  let root = createRoot(rootElement);
  await act(async () => { render(root); await wait(5); });
  await act(async () => { click(button('Nouveau ticket GLPI')); await wait(10); });
  await act(async () => { await wait(10); });
  await act(async () => {
    setField('select', client.id);
    setField('input[required][maxlength="250"]', 'Ticket incertain');
    setField('textarea[required]', 'Description canonique');
    await wait(5);
  });
  await act(async () => { document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await wait(10); });
  assert.match(document.body.textContent, /Résultat incertain/);
  assert.ok(localStorage.getItem(GLPI_UNCERTAIN_STORAGE_KEY));
  assert.equal(glpiTicketCreates, 1);

  await act(async () => { root.unmount(); await wait(0); });
  rootElement.innerHTML = '';
  root = createRoot(rootElement);
  await act(async () => { render(root); await wait(10); });
  assert.ok(button('Nouveau ticket GLPI'));
  await act(async () => { click(button('Nouveau ticket GLPI')); await wait(10); });
  assert.match(document.body.textContent, /Le même UUID et le même payload/);
  await act(async () => { click(button('Récupérer le résultat')); await wait(10); });
  assert.match(document.body.textContent, /Ticket créé dans GLPI/);
  assert.equal(glpiTicketCreates, 1, 'the remount must not cause a second underlying GLPI Ticket creation');
  assert.equal(localStorage.getItem(GLPI_UNCERTAIN_STORAGE_KEY), null);
  await act(async () => { root.unmount(); await wait(0); });
});
