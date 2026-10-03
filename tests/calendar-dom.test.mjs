import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import TimeCalendar from '../app/time-calendar.tsx';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:5174/' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'Node', 'Element', 'DocumentFragment', 'MutationObserver', 'getComputedStyle']) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(Date.now()), 0);
globalThis.cancelAnimationFrame = id => clearTimeout(id);
globalThis.confirm = () => true;
if (!globalThis.crypto?.randomUUID) Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value: dom.window.crypto });

const client = { id: 'client-1', name: 'Client DOM', active: 1, color: null, glpi_entity_id: null, hourly_rate_cents: null, onsite_hourly_rate_cents: null };
const member = { id: 'member-1', user_id: 'member-1', email: 'dom@example.test', name: 'DOM Tester', role: 'partner', active: 1, travel_fee_cents: null, provider: null, login: null };
const initialEntry = { id: '11111111-1111-1111-1111-111111111111', member_id: member.id, client_id: client.id, client: client.name, member: member.name, ticket: 'DOM-FOCUS', date: '2026-10-02', start: 600, end: 660, description: '', on_site: 0, hourly_rate_cents: null, travel_cents: null, travel_counted: 0, billed: 0, version: 1 };
let serverEntry = { ...initialEntry };
const posts = [];

globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  if (url.includes('/api/time?')) {
    return new Response(JSON.stringify({ me: member, clients: [client], members: [member], entries: [{ ...serverEntry }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (url === '/api/time' && init.method === 'POST') {
    const body = JSON.parse(String(init.body));
    posts.push(body);
    assert.equal(body.action, 'saveEntry');
    serverEntry = { ...serverEntry, date: body.date, start: Number(body.start.slice(0, 2)) * 60 + Number(body.start.slice(3)), end: body.end === '00:00' ? 1440 : Number(body.end.slice(0, 2)) * 60 + Number(body.end.slice(3)), version: serverEntry.version + 1 };
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error(`Unexpected fetch ${url}`);
};

function wait(milliseconds = 0) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

test('real React DOM keeps the same calendar handle focused across two saves and a late parent reload', async () => {
  function Harness() {
    const [parentRevision, setParentRevision] = useState(0);
    const parentData = { me: member, clients: [client], members: [member], entries: parentRevision ? [{ ...serverEntry }] : [{ ...initialEntry }] };
    async function onSaved() {
      await wait(35);
      setParentRevision(value => value + 1);
    }
    return React.createElement(TimeCalendar, { data: parentData, onSaved });
  }

  const rootElement = document.getElementById('root');
  const root = createRoot(rootElement);
  await act(async () => { root.render(React.createElement(Harness)); await wait(20); });
  const handle = () => document.querySelector('[data-entry-id="11111111-1111-1111-1111-111111111111"][data-calendar-handle="end"]');
  for (let attempt = 0; attempt < 20 && !handle(); attempt++) await act(async () => { await wait(5); });
  assert.ok(handle(), 'the real CalendarItem handle should be mounted');

  await act(async () => { handle().focus(); handle().dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await wait(80); });
  for (let attempt = 0; attempt < 20 && document.activeElement !== handle(); attempt++) await act(async () => { await wait(5); });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].start, '10:00');
  assert.equal(posts[0].end, '11:15');
  assert.equal(document.activeElement?.dataset.calendarHandle, 'end', 'focus must return to the same end handle after the late parent reload');

  await act(async () => { document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await wait(80); });
  for (let attempt = 0; attempt < 20 && document.activeElement?.dataset.calendarHandle !== 'end'; attempt++) await act(async () => { await wait(5); });
  assert.equal(posts.length, 2, 'the second keyboard adjustment must use the live React handler');
  assert.equal(posts[1].end, '11:30');
  assert.equal(document.activeElement?.dataset.entryId, initialEntry.id);
  assert.equal(document.activeElement?.dataset.calendarHandle, 'end');
  await act(async () => { root.unmount(); await wait(0); });
});
