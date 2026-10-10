import test from 'node:test';
import assert from 'node:assert/strict';
import { partnerStatement } from '../lib/partner-export.ts';
import { visibleEntry } from '../lib/entry-visibility.ts';
const entry = (id, overrides = {}) => ({id,member_id:'alice',client_id:'client',client:'Client',member:'Alice',ticket:'Ticket',ticket_source:'pending',glpi_ticket_id:null,date:'2026-10-01',start:540,end:556,description:'',on_site:0,hourly_rate_cents:98765,provider_rate_cents:5000,travel_cents:0,travel_counted:0,billed:0,version:1,...overrides});
test('provider allowlist drops sale values and unknown internal commercial fields', () => {
 const raw=entry('a',{color:'#123456',client_margin:1234,contract:'Secret'});
 const safe=visibleEntry(raw,'partner');assert.equal(safe.hourly_rate_cents,null);assert.equal(safe.provider_rate_cents,5000);assert.equal(safe.color,'#123456');assert.equal('contract' in safe,false);assert.equal('client_margin' in safe,false);assert.equal(visibleEntry(raw,'admin'),raw);
});
test('supplier remuneration rounds each entry, adds counted travel once, never uses sale rates', () => {
 const rows=[entry('b',{start:600,end:615,travel_counted:0,on_site:1}),entry('a',{travel_counted:1,travel_cents:2000,on_site:1})];
 const table=partnerStatement(rows,'Alice');assert.equal(table[0].length,17);assert.equal(table[1][14],'50,00');assert.equal(table[1][15],'25,00');assert.equal(table[1][16],'45,00');assert.equal(table[2][15],'12,50');assert.equal(table.at(-1)[15],'37,50');assert.equal(table.at(-1)[16],'57,50');assert.equal(JSON.stringify(table).includes('98765'),false);
});
test('missing remuneration is explicit and never inferred from client prices or treated as zero', () => {
 const table=partnerStatement([entry('a',{provider_rate_cents:null})],'Alice');assert.match(table[1][13],/Tarif prestataire non renseigné/);assert.equal(table[1][14],'');assert.equal(table[1][15],'');assert.equal(table.at(-1)[15],'');assert.equal(table.at(-1)[16],'');assert.match(table.at(-1)[13],/1 tarif/);
 const zero=partnerStatement([entry('zero',{provider_rate_cents:0})],'Alice');assert.equal(zero[1][14],'0,00');assert.equal(zero.at(-1)[15],'0,00');assert.equal(zero.at(-1)[16],'0,00');assert.equal(zero.at(-1)[13],'');
});
test('unknown mode or missing travel prevents claiming a complete grand total', () => {
 for(const overrides of [{on_site:null},{on_site:1,travel_counted:1,travel_cents:null}]){const table=partnerStatement([entry('a',overrides)],'Alice');assert.equal(table[1][15],'25,00');assert.equal(table[1][16],'');assert.equal(table.at(-1)[16],'');assert.notEqual(table.at(-1)[13],'');}
});
