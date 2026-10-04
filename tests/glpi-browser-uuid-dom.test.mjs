import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { glpiUncertainStorageKey } from '../lib/glpi-draft.ts';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://192.168.1.20/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLAnchorElement', 'Node', 'NodeFilter', 'Element', 'DocumentFragment', 'MutationObserver', 'getComputedStyle', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'FocusEvent']) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: dom.window.localStorage });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = id => clearTimeout(id);
globalThis.PointerEvent = dom.window.MouseEvent;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { createRoot } = await import('react-dom/client');
const { default: NewGlpiTicket } = await import('../app/new-glpi-ticket.tsx');
const { BROWSER_UUID_UNAVAILABLE_MESSAGE } = await import('../lib/browser-uuid.ts');

const memberId = 'uuid-fail-closed-member';
const client = { id: 'uuid-fail-closed-client', name: 'Client UUID', active: 1, color: null, glpi_entity_id: 4, hourly_rate_cents: null, onsite_hourly_rate_cents: null };
const clients = [client];
let scenario = 'terminal-submit';
let createBodies = [];

function secureCrypto() {
  let sequence = 1;
  return { randomUUID: () => `00000000-0000-4000-8000-${String(sequence++).padStart(12, '0')}` };
}
function setCrypto(value) {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value });
}
function terminalRejection() {
  return new Response(JSON.stringify({ error: 'Création refusée par GLPI.', code: 'CREATION_REJECTED', terminal: true, retryable: false, preserveOperation: false }), { status: 422, headers: { 'Content-Type': 'application/json' } });
}

globalThis.fetch = async (input, init = {}) => {
  const target = new URL(String(input), 'http://192.168.1.20/');
  if (target.pathname === '/api/glpi' && init.method === 'POST') {
    const body = JSON.parse(String(init.body));
    assert.equal(body.action, 'createTicket');
    createBodies.push(body);
    if (scenario === 'terminal-submit') return terminalRejection();
    if (createBodies.length === 1) {
      return new Response(JSON.stringify({ error: 'État fournisseur incertain.', code: 'CONFIG_NOT_READY', terminal: false, retryable: true, preserveOperation: true, uncertain: true }), { status: 409, headers: { 'Content-Type': 'application/json' } });
    }
    return terminalRejection();
  }
  if (target.pathname === '/api/glpi' && target.searchParams.has('uncertain')) return new Response(JSON.stringify({ requests: [], recoverable: [], blocked: false }), { status: 200 });
  if (target.pathname === '/api/glpi' && target.searchParams.has('createOptions')) return new Response(JSON.stringify({ categories: [], limited: false }), { status: 200 });
  if (target.pathname === '/api/glpi') return new Response(JSON.stringify({ configured: true, connected: true, canCreate: true, web: 'http://glpi.invalid' }), { status: 200 });
  throw new Error(`Unexpected fetch ${target}`);
};

function wait(milliseconds = 0) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }
function button(label) { return [...document.querySelectorAll('button')].find(value => value.textContent?.includes(label)); }
function setField(field, value) {
  const setter = Object.getOwnPropertyDescriptor(field.constructor.prototype, 'value')?.set;
  setter?.call(field, value);
  field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  field.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}
async function mountDraft(title, description) {
  const container = document.getElementById('root');
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(NewGlpiTicket, { clients, memberId, onCreated: () => {} })); await wait(20); });
  await act(async () => { button('Nouveau ticket GLPI').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(25); });
  const form = document.querySelector('form.quick-form');
  assert.ok(form, document.body.textContent);
  await act(async () => {
    setField(form.querySelector('select'), client.id);
    setField(form.querySelector('input[maxlength="250"]'), title);
    setField(form.querySelector('textarea'), description);
    await wait(0);
  });
  return { root, container, form };
}
async function unmount(mounted) {
  await act(async () => { mounted.root.unmount(); await wait(0); });
  mounted.container.innerHTML = '';
}
function assertFailClosed(mounted, title, description, postCount) {
  assert.ok(document.body.textContent.includes(BROWSER_UUID_UNAVAILABLE_MESSAGE));
  assert.equal(mounted.form.querySelector('input[maxlength="250"]').value, title);
  assert.equal(mounted.form.querySelector('textarea').value, description);
  assert.equal(button('Créer dans GLPI').disabled, true, 'invalid UUID disables ticket creation');
  assert.equal(createBodies.length, postCount);
  assert.equal(localStorage.getItem(glpiUncertainStorageKey(memberId)), null, 'empty UUID is never persisted');
}

test('terminal provider rejection plus UUID renewal failure blocks every retry before POST', async () => {
  localStorage.clear();
  scenario = 'terminal-submit';
  createBodies = [];
  setCrypto(secureCrypto());
  const title = 'Terminal provider rejection';
  const description = 'Fields survive a failed secure UUID renewal.';
  const mounted = await mountDraft(title, description);
  setCrypto(undefined);
  await act(async () => { mounted.form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await wait(25); });
  assertFailClosed(mounted, title, description, 1);
  await act(async () => { mounted.form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await wait(10); });
  assertFailClosed(mounted, title, description, 1);
  await unmount(mounted);
});

test('terminal recovery plus UUID renewal failure blocks every retry before POST', async () => {
  localStorage.clear();
  scenario = 'terminal-recovery';
  createBodies = [];
  setCrypto(secureCrypto());
  const title = 'Terminal recovery rejection';
  const description = 'Recovery keeps fields but cannot reuse an invalid UUID.';
  const mounted = await mountDraft(title, description);
  await act(async () => { mounted.form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await wait(25); });
  assert.match(document.body.textContent, /Résultat incertain/);
  setCrypto(undefined);
  await act(async () => { button('Récupérer le résultat').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); await wait(25); });
  assertFailClosed(mounted, title, description, 2);
  await act(async () => { mounted.form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await wait(10); });
  assertFailClosed(mounted, title, description, 2);
  await unmount(mounted);
});
