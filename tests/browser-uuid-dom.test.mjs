import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://192.168.1.20/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'Node', 'Element', 'DocumentFragment', 'MutationObserver', 'getComputedStyle', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'FocusEvent']) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
}
Object.defineProperty(globalThis, 'localStorage', { configurable: true, writable: true, value: dom.window.localStorage });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = id => clearTimeout(id);
globalThis.PointerEvent = dom.window.MouseEvent;
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

const { createRoot } = await import('react-dom/client');
const { default: QuickEntry } = await import('../app/quick-entry.tsx');
const { BROWSER_UUID_UNAVAILABLE_MESSAGE } = await import('../lib/browser-uuid.ts');

const client = { id: 'client-1', name: 'Client LAN', active: 1, color: null, glpi_entity_id: null, hourly_rate_cents: null, onsite_hourly_rate_cents: null };
const member = { id: 'member-1', user_id: 'member-1', email: 'lan@example.test', name: 'LAN Tester', role: 'partner', active: 1, travel_fee_cents: null, provider: null, login: null };
const data = { me: member, clients: [client], members: [member], entries: [] };

function setCrypto(value) {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value });
}

function wait(milliseconds = 0) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }

test('quick entry works on plain LAN HTTP through getRandomValues and blocks POST when all CSPRNG APIs are unavailable', async () => {
  const rootElement = document.getElementById('root');
  let calls = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ input: String(input), init });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  setCrypto({
    getRandomValues(bytes) {
      bytes.fill(0xaa);
      return bytes;
    },
  });
  let root = createRoot(rootElement);
  await act(async () => { root.render(React.createElement(QuickEntry, { data, seed: null, mode: 'timer', onClose: () => {}, onSaved: () => {} })); await wait(0); });
  await act(async () => { document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await wait(0); });
  const mutationCalls = calls.filter(call => call.init.method === 'POST');
  assert.equal(mutationCalls.length, 1);
  const body = JSON.parse(String(mutationCalls[0].init.body));
  assert.equal(body.id, 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa');
  assert.equal(body.action, 'start');
  await act(async () => { root.unmount(); await wait(0); });

  rootElement.innerHTML = '';
  calls = [];
  setCrypto(undefined);
  root = createRoot(rootElement);
  await act(async () => { root.render(React.createElement(QuickEntry, { data, seed: null, mode: 'timer', onClose: () => {}, onSaved: () => {} })); await wait(0); });
  assert.ok(document.body.textContent.includes(BROWSER_UUID_UNAVAILABLE_MESSAGE));
  await act(async () => { document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); await wait(0); });
  assert.equal(calls.filter(call => call.init.method === 'POST').length, 0, 'no API request may be sent without a secure UUID');
  assert.match(document.body.textContent, /HTTPS|navigateur récent/);
  await act(async () => { root.unmount(); await wait(0); });
});
