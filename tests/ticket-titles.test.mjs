import test from 'node:test';
import assert from 'node:assert/strict';
import {clientStatement} from '../lib/client-export.ts';
import {ticketTitleLabel,historicalTicketId} from '../lib/ticket-title.ts';
import {csv} from '../lib/business.ts';
const entry={id:'e',member:'Secret provider',member_id:'secret-id',client:'Client',client_id:'client',ticket:'GLPI-1141',ticket_source:'glpi',glpi_ticket_id:1141,ticket_title:'Connexion RDP — échec',date:'2026-10-21',start:540,end:556,on_site:0,description:'PRIVATE NOTE',hourly_rate_cents:98765,provider_rate_cents:5000,travel_cents:2000,travel_counted:1,billed:0,version:1};
test('client statement includes ticket title and per-entry rounded duration, excludes commercial and provider data',()=>{
 const table=clientStatement([entry]);assert.equal(table[0].length,7);assert.deepEqual(table[1],['2026-10-21','09:00','09:16',30,'À distance','GLPI-1141','Connexion RDP — échec']);const value=csv(table);assert.doesNotMatch(value,/Secret provider|secret-id|PRIVATE NOTE|98765|5000|2000/);
});
test('CSV protects formulas and quotes in GLPI titles and sorts chronologically',()=>{
 const table=clientStatement([{...entry,ticket_title:'=HYPERLINK("x")',start:600,end:615},entry]);assert.equal(table[1][1],'09:00');assert.match(csv(table),/\'=HYPERLINK/);assert.match(csv(table),/""x""/);
});
test('missing titles are explicit; pending and historical references are never invented',()=>{
 assert.equal(ticketTitleLabel({...entry,ticket_title:null}),'Intitulé non disponible');assert.equal(ticketTitleLabel({ticket_source:'pending',ticket_title:null}),'À compléter');assert.equal(historicalTicketId(entry),1141);assert.equal(historicalTicketId({...entry,ticket_source:'legacy',glpi_ticket_id:null}),1141);
 for(const ticket of ['1141','GLPI-0','GLPI-1141 extra','GLPI-999999999999999999999'])assert.equal(historicalTicketId({...entry,ticket_source:'legacy',ticket}),null);assert.equal(historicalTicketId({...entry,ticket_source:'pending'}),null);
});
