import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import React, { act, useState } from 'react';
import { ticketSelectionReady } from '../lib/ticket-selection.ts';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://192.168.1.20/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLInputElement', 'Node', 'Element', 'DocumentFragment', 'MutationObserver', 'getComputedStyle', 'Event', 'MouseEvent', 'KeyboardEvent']) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const { default: TicketPicker } = await import('../components/ticket-picker.tsx');
const client = { id: 'client-1', name: 'Mapped client', active: 1, color: null, glpi_entity_id: 4, hourly_rate_cents: null, onsite_hourly_rate_cents: null };
const requests = [];
globalThis.fetch = (input, init = {}) => new Promise(resolve => requests.push({ url: String(input), init, resolve }));
const response = tickets => new Response(JSON.stringify({ tickets, total: tickets.length }), { status: 200, headers: { 'Content-Type': 'application/json' } });
const ticket = (id, title = `Ticket ${id}`) => ({ id, title, status: 2, entity: 4, url: `http://glpi/Ticket/${id}`, client_id: client.id, client: client.name, client_active: 1 });
const wait = (milliseconds = 0) => new Promise(resolve => setTimeout(resolve, milliseconds));
function setInput(input, value) { const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set; setter.call(input, value); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }

test('shared ticket combobox ignores stale results, supports keyboard selection and explicit pending', async () => {
  function Harness() {
    const [value, setValue] = useState({ ticket: '', ticket_source: undefined, glpi_ticket_id: null });
    const [clientId, setClientId] = useState(client.id);
    return React.createElement(React.Fragment, null,
      React.createElement(TicketPicker, { value, clientId, clients: [client], onChange: next => { setValue(previous => ({ ...previous, ...next })); if (next.client_id) setClientId(next.client_id); } }),
      React.createElement('button', { id: 'save', disabled: !ticketSelectionReady(value) }, 'Save'));
  }
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(Harness)); await wait(0); });
  const input = document.querySelector('[role="combobox"]');
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  await act(async () => { input.focus(); setInput(input, 'old'); await wait(320); });
  assert.match(document.querySelector('[role="status"]').textContent, /en cours/);
  const old = requests.at(-1);
  await act(async () => { setInput(input, 'new'); await wait(320); });
  const fresh = requests.at(-1);
  await act(async () => { fresh.resolve(response([ticket(123, 'Fresh result')])); await wait(0); });
  assert.match(document.body.textContent, /Fresh result/);
  assert.match(document.querySelector('[role="status"]').textContent, /1 suggestion disponible/);
  await act(async () => { old.resolve(response([ticket(999, 'Stale result')])); await wait(0); });
  assert.doesNotMatch(document.body.textContent, /Stale result/);
  assert.equal(input.getAttribute('aria-controls')?.length > 0, true);
  await act(async () => { input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(0); });
  assert.equal(input.value, 'GLPI-123');
  assert.equal(document.getElementById('save').disabled, false);
  await act(async () => { input.focus(); input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(0); });
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, input, 'Escape restores focus to the combobox');
  await act(async () => { setInput(input, 'invented'); await wait(0); });
  assert.equal(document.getElementById('save').disabled, true, 'typing clears structured identity');
  await act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent.includes('À compléter plus tard')).click(); await wait(0); });
  assert.equal(input.value, 'À compléter');
  assert.equal(document.getElementById('save').disabled, false);
  await act(async () => { root.unmount(); await wait(0); });
});

test('combobox announces empty/error states, exposes closed tickets, disables unusable mappings and clears identity on client change or focus leave', async () => {
  requests.length = 0;
  const archived = { ...client, id: 'client-archived', name: 'Archived client', active: 0, glpi_entity_id: 9 };
  const other = { ...client, id: 'client-2', name: 'Other client', glpi_entity_id: 8 };
  function Harness() {
    const [value, setValue] = useState({ ticket: '', ticket_source: undefined, glpi_ticket_id: null });
    const [clientId, setClientId] = useState(client.id);
    return React.createElement(React.Fragment, null,
      React.createElement(TicketPicker, { value, clientId, clients: [client, archived, other], onChange: next => { setValue(previous => ({ ...previous, ...next })); if (next.client_id) setClientId(next.client_id); } }),
      React.createElement('button', { id: 'switch-client', onClick: () => setClientId(other.id) }, 'Switch client'),
      React.createElement('button', { id: 'outside' }, 'Outside'),
      React.createElement('output', { id: 'identity' }, value.ticket_source || 'none'));
  }
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(Harness)); await wait(0); });
  const input = document.querySelector('[role="combobox"]');
  await act(async () => { input.focus(); setInput(input, 'none'); await wait(320); });
  await act(async () => { requests.at(-1).resolve(response([])); await wait(0); });
  assert.match(document.querySelector('[role="status"]').textContent, /Aucun ticket trouvé/);
  await act(async () => { setInput(input, 'failure'); await wait(320); });
  await act(async () => { requests.at(-1).resolve(new Response(JSON.stringify({ error: 'GLPI indisponible' }), { status: 503, headers: { 'Content-Type': 'application/json' } })); await wait(0); });
  assert.match(document.querySelector('[role="alert"]').textContent, /GLPI indisponible.*À compléter/);
  const closedToggle = [...document.querySelectorAll('input[type="checkbox"]')][0];
  await act(async () => { closedToggle.click(); await wait(320); });
  assert.match(requests.at(-1).url, /open=false/);
  const unusable = [
    { ...ticket(201, 'Unmapped'), client_id: null, client: null, client_active: null, entity: 77 },
    { ...ticket(202, 'Archived'), client_id: archived.id, client: archived.name, client_active: 0, entity: 9 },
    ticket(203, 'Selectable')
  ];
  await act(async () => { requests.at(-1).resolve(response(unusable)); await wait(0); });
  const options = [...document.querySelectorAll('[role="option"]')];
  assert.equal(options[0].disabled, true); assert.equal(options[0].getAttribute('aria-disabled'), 'true');
  assert.equal(options[1].disabled, true); assert.match(options[1].textContent, /client archivé/);
  await act(async () => { options[2].click(); await wait(0); });
  assert.equal(document.getElementById('identity').textContent, 'glpi');
  await act(async () => { document.getElementById('switch-client').click(); await wait(0); });
  assert.equal(input.value, ''); assert.equal(document.getElementById('identity').textContent, 'none');
  await act(async () => { input.focus(); document.getElementById('outside').focus(); await wait(0); });
  assert.equal(input.getAttribute('aria-expanded'), 'false', 'focus leaving the picker closes its popup');
  await act(async () => { root.unmount(); await wait(0); }); container.remove();
});

test('the shared picker is wired into quick entry (entry and timer), Prestations and Calendar', () => {
  assert.match(readFileSync('app/quick-entry.tsx', 'utf8'), /<TicketPicker/);
  assert.match(readFileSync('app/workspace.tsx', 'utf8'), /<TicketPicker/);
  assert.match(readFileSync('app/time-calendar.tsx', 'utf8'), /<TicketPicker/);
  assert.match(readFileSync('app/workspace.tsx', 'utf8'), /ticket-source.*ticketBadge/);
});
