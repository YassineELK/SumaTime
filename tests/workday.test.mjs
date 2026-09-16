import test from 'node:test';
import assert from 'node:assert/strict';
import { timerSegments, brusselsMoment, suggestedTimes } from '../lib/workday.ts';
test('timer covers actual minutes and always at least one minute',()=>{
  const at=Date.parse('2026-09-16T08:00:23Z');
  assert.deepEqual(timerSegments(at,at+15*60000),[{date:'2026-09-16',start:600,end:616}]);
  assert.deepEqual(timerSegments(at,at),[{date:'2026-09-16',start:600,end:601}]);
});
test('midnight produces two distinct billable days, without a zero-length day',()=>{
  assert.deepEqual(timerSegments(Date.parse('2026-09-16T21:45:00Z'),Date.parse('2026-09-16T22:15:00Z')),[{date:'2026-09-16',start:1425,end:1440},{date:'2026-09-17',start:0,end:15}]);
  assert.deepEqual(timerSegments(Date.parse('2026-09-16T21:45:00Z'),Date.parse('2026-09-16T22:00:00Z')),[{date:'2026-09-16',start:1425,end:1440}]);
});
test('DST changes cannot silently create incorrect civil times',()=>{
  for(const date of ['2026-03-29','2026-10-25'])assert.throws(()=>timerSegments(Date.parse(date+'T00:30:00Z'),Date.parse(date+'T01:30:00Z')),/changement d’heure/);
  assert.throws(()=>timerSegments(100,99),/invalides/);
  assert.throws(()=>timerSegments(100,100+25*3600000),/24 heures/);
});
test('suggestions use Brussels quarter hours including the midnight boundary',()=>{
  assert.deepEqual(suggestedTimes(Date.parse('2026-09-16T08:17:00Z')),{date:'2026-09-16',start:'10:15',end:'10:30'});
  assert.deepEqual(suggestedTimes(Date.parse('2026-09-16T21:59:00Z')),{date:'2026-09-16',start:'23:45',end:'00:00'});
  assert.deepEqual(brusselsMoment(Date.parse('2026-01-01T23:00:00Z')),{date:'2026-01-02',minute:0});
});
