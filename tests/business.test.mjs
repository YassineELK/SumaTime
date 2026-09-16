import { test } from 'node:test';
import assert from 'node:assert/strict';
import { billedMinutes, clockTime, csv, parseTime, validDate } from '../lib/business.ts';
test('round each entry up to a quarter-hour and retain exact boundaries', () => {
  assert.equal(billedMinutes(540, 555), 15);
  assert.equal(billedMinutes(540, 556), 30);
  assert.equal(billedMinutes(540, 541), 15);
  assert.equal(billedMinutes(540, 600), 60);
});
test('validate real dates and clock times', () => {
  assert.equal(validDate('2026-02-30'), false);
  assert.equal(validDate('2028-02-29'), true);
  assert.equal(validDate('2026-2-03'), false);
  assert.equal(parseTime('09:16'), 556);
  assert.throws(() => parseTime('25:30'));
  assert.throws(() => parseTime('12:60'));
  assert.equal(clockTime(1440), '24:00');
});
test('CSV escapes formula injection, delimiters, quotes and preserves UTF-8 BOM', () => {
  const value = csv([['Client', '=SUM(1;2)', '"quoted"', 'éè', '\t=cmd', ' @test']]);
  assert.ok(value.startsWith('\ufeff'));
  assert.ok(value.includes('"\'=SUM(1;2)"'));
  assert.ok(value.includes('"""quoted"""'));
  assert.ok(value.includes('"\'\t=cmd"'));
  assert.ok(value.includes('"\' @test"'));
});
