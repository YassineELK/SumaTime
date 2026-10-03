import test from 'node:test';
import assert from 'node:assert/strict';
import { findCalendarFocus, adjustedRange } from '../lib/calendar.ts';

const node = (entryId, calendarHandle) => ({ dataset: { entryId, calendarHandle }, focused: false });

test('calendar DOM focus contract survives two keyboard saves on the same handle', () => {
  const target = { id: 'entry-1', handle: 'end' };
  let dom = [node('entry-1', 'body'), node('entry-1', 'start'), node('entry-1', 'end'), node('entry-1', 'move')];
  const first = findCalendarFocus(dom, target);
  assert.equal(first?.dataset.calendarHandle, 'end');
  const firstRange = adjustedRange(547, 622, 15, 'end');
  assert.deepEqual(firstRange, { start: 547, end: 637 });

  // A successful save replaces the event DOM. The same semantic target is
  // resolved again, so the next ArrowDown needs no mouse or tab restart.
  dom = [node('entry-1', 'body'), node('entry-1', 'start'), node('entry-1', 'end'), node('entry-1', 'move')];
  const second = findCalendarFocus(dom, target);
  assert.equal(second?.dataset.calendarHandle, 'end');
  const secondRange = adjustedRange(firstRange.start, firstRange.end, 15, 'end');
  assert.deepEqual(secondRange, { start: 547, end: 652 });
  assert.equal(findCalendarFocus(dom, { id: 'removed', handle: 'end' }), null);
});
