import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, weekStart, selectedRange, slotAt, layoutEntries, overlaps, adjustedRange } from '../lib/calendar.ts';

const entry = (id, start, end, member_id = 'me') => ({ id, start, end, member_id, date: '2026-09-16' });
test('calendar weeks start on Monday across months, years and DST', () => {
  assert.equal(weekStart('2026-09-16'), '2026-09-14');
  assert.equal(weekStart('2026-09-20'), '2026-09-14');
  assert.equal(weekStart('2026-09-14'), '2026-09-14');
  assert.equal(weekStart('2027-01-01'), '2026-12-28');
  assert.equal(addDays('2026-03-29', 1), '2026-03-30');
  assert.equal(addDays('2026-10-25', -1), '2026-10-24');
});
test('forward, reverse, single slot and midnight selection retain quarter-hour boundaries', () => {
  assert.deepEqual(selectedRange(36, 39), { start: 540, end: 600 });
  assert.deepEqual(selectedRange(39, 36), { start: 540, end: 600 });
  assert.deepEqual(selectedRange(36, 36), { start: 540, end: 555 });
  assert.deepEqual(selectedRange(95, 95), { start: 1425, end: 1440 });
  assert.deepEqual(selectedRange(-10, 100), { start: 0, end: 1440 });
  assert.equal(slotAt(100 + 36 * 24 + 12, 100, 2304), 36);
  assert.equal(slotAt(-40, 100, 2304), 0);
  assert.equal(slotAt(9999, 100, 2304), 95);
});
test('only genuine conflicts for the same member and date block a selection', () => {
  const rows = [entry('a', 540, 600), entry('b', 600, 660, 'other')];
  assert.equal(overlaps(600, 660, rows, 'me', '2026-09-16'), false);
  assert.equal(overlaps(590, 620, rows, 'me', '2026-09-16'), true);
  assert.equal(overlaps(540, 600, rows, 'me', '2026-09-17'), false);
  assert.equal(overlaps(540, 600, rows, 'me', '2026-09-16', 'a'), false);
});
test('concurrent team entries are visible in separate lanes; touching events use one lane', () => {
  const rows = [entry('a', 540, 660), entry('b', 570, 600), entry('c', 600, 690), entry('d', 690, 720)];
  const result = layoutEntries(rows);
  assert.deepEqual(result.map(e => [e.entry.id, e.lane, e.lanes]), [['a',0,2],['b',1,2],['c',1,2],['d',0,1]]);
  assert.equal(layoutEntries([]).length, 0);
  assert.deepEqual(layoutEntries([entry('a',0,15),entry('b',15,30)]).map(e => e.lanes), [1,1]);
  assert.deepEqual(layoutEntries([entry('a',0,1),entry('b',1,2)], 12.5).map(e => [e.lane,e.lanes]), [[0,2],[1,2]]);
});

test('calendar moves retain exact minute duration and stay within the day',()=>{
 assert.deepEqual(adjustedRange(547,622,15,'move'),{start:562,end:637});
 assert.deepEqual(adjustedRange(547,622,-900,'move'),{start:0,end:75});
 assert.deepEqual(adjustedRange(547,622,900,'move'),{start:1365,end:1440});
 assert.deepEqual(adjustedRange(547,622,15,'start'),{start:562,end:622});
 assert.deepEqual(adjustedRange(547,622,-15,'end'),{start:547,end:607});
 assert.deepEqual(adjustedRange(547,622,900,'start'),{start:621,end:622});
 assert.deepEqual(adjustedRange(547,622,-900,'end'),{start:547,end:548});
});
