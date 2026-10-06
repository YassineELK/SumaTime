import test from 'node:test';
import assert from 'node:assert/strict';
import { timerSegments, brusselsMoment, suggestedTimes, reviewTimerSegments } from '../lib/workday.ts';
test('timer rounds start down and end up to quarter-hours',()=>{
  const at=Date.parse('2026-09-16T08:00:23Z');
  assert.deepEqual(timerSegments(at,at+15*60000),[{date:'2026-09-16',start:600,end:630}]);
  assert.deepEqual(timerSegments(at,at),[{date:'2026-09-16',start:600,end:615}]);
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
test('DST validation uses measured instants before applying civil rounding',()=>{
  assert.deepEqual(timerSegments(Date.parse('2026-03-29T00:40:00Z'),Date.parse('2026-03-29T00:50:00Z')),[{date:'2026-03-29',start:90,end:120}]);
  assert.deepEqual(timerSegments(Date.parse('2026-03-29T00:40:00Z'),Date.parse('2026-03-29T01:00:00Z')),[{date:'2026-03-29',start:90,end:120}]);
  assert.throws(()=>timerSegments(Date.parse('2026-03-29T00:40:00Z'),Date.parse('2026-03-29T01:10:00Z')),/changement d’heure/);
  assert.throws(()=>timerSegments(Date.parse('2026-10-25T00:40:00Z'),Date.parse('2026-10-25T01:10:00Z')),/changement d’heure/);
  assert.deepEqual(timerSegments(Date.parse('2026-10-25T00:40:00Z'),Date.parse('2026-10-25T00:50:00Z')),[{date:'2026-10-25',start:150,end:180}]);
  assert.deepEqual(timerSegments(Date.parse('2026-10-25T00:40:00Z'),Date.parse('2026-10-25T01:00:00Z')),[{date:'2026-10-25',start:150,end:180}]);
});
test('suggestions use Brussels quarter hours including the midnight boundary',()=>{
  assert.deepEqual(suggestedTimes(Date.parse('2026-09-16T08:17:00Z')),{date:'2026-09-16',start:'10:15',end:'10:30'});
  assert.deepEqual(suggestedTimes(Date.parse('2026-09-16T21:59:00Z')),{date:'2026-09-16',start:'23:45',end:'00:00'});
  assert.deepEqual(brusselsMoment(Date.parse('2026-01-01T23:00:00Z')),{date:'2026-01-02',minute:0});
});

test('requested timer rounding: 09:07 to 10:22 becomes 09:00 to 10:30',()=>{
  assert.deepEqual(timerSegments(Date.parse('2026-10-02T07:07:00Z'),Date.parse('2026-10-02T08:22:00Z')),[{date:'2026-10-02',start:540,end:630}]);
  assert.deepEqual(timerSegments(Date.parse('2026-10-02T07:00:00Z'),Date.parse('2026-10-02T07:15:00Z')),[{date:'2026-10-02',start:540,end:555}]);
  assert.deepEqual(timerSegments(Date.parse('2026-10-02T07:00:00Z'),Date.parse('2026-10-02T07:15:01Z')),[{date:'2026-10-02',start:540,end:570}]);
  assert.deepEqual(timerSegments(Date.parse('2026-10-02T21:59:40Z'),Date.parse('2026-10-02T22:00:01Z')),[{date:'2026-10-02',start:1425,end:1440},{date:'2026-10-03',start:0,end:15}]);
});

test('forgotten timers require explicit minute-precise corrections within their dates',()=>{
  const start=Date.parse('2026-09-20T07:07:00Z'),stop=Date.parse('2026-09-22T08:22:00Z'),today='2026-09-22';
  const segment={date:'2026-09-20',start:'09:07',end:'10:22'};
  assert.deepEqual(reviewTimerSegments(start,stop,[segment],today),[{date:segment.date,start:547,end:622}]);
  for(const values of [undefined,[],[{...segment,date:'2026-09-19'}],[{...segment,date:'2026-09-23'}],[{...segment,date:'2026-09-31'}],[segment,segment],[{...segment,end:'09:06'}],[{...segment,start:'bad'}],Array(32).fill(segment)])assert.throws(()=>reviewTimerSegments(start,stop,values,today));
  assert.throws(()=>reviewTimerSegments(start,stop,[{...segment,date:'2026-09-22'}],'2026-09-21'),/future/);
  assert.deepEqual(reviewTimerSegments(start,stop,[{date:'2026-09-21',start:'23:17',end:'00:00'},segment],today),[{date:'2026-09-20',start:547,end:622},{date:'2026-09-21',start:1397,end:1440}]);
});
test('normal reviews keep their original dates and DST warnings remain manually recoverable',()=>{
  const start=Date.parse('2026-09-20T07:07:00Z'),stop=start+3600000;
  assert.deepEqual(reviewTimerSegments(start,stop,undefined,'2026-09-22'),timerSegments(start,stop));
  assert.throws(()=>reviewTimerSegments(start,stop,[{date:'2026-09-21',start:'09:00',end:'10:00'}],'2026-09-22'));
  const springStart=Date.parse('2026-03-29T00:30:00Z'),springStop=Date.parse('2026-03-29T01:30:00Z');
  assert.deepEqual(reviewTimerSegments(springStart,springStop,[{date:'2026-03-29',start:'01:30',end:'02:30'}],'2026-09-22'),[{date:'2026-03-29',start:90,end:150}]);
});
