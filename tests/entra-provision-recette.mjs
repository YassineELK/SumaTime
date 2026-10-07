import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tenant, aliceOid, bobOid } from './entra-mock.mjs';
const base = process.env.TEST_URL, db = new DatabaseSync(process.env.DATABASE_PATH);
const kioskOid='88888888-8888-4888-8888-888888888888',upnOid='99999999-9999-4999-8999-999999999999',ownerOid='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const assigned=[aliceOid,bobOid,kioskOid,upnOid,ownerOid,'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','dddddddd-dddd-4ddd-8ddd-dddddddddddd'];
let checks=0;
function same(a,b,m){assert.deepEqual(a,b,m);checks++;}
function tick(ms=61001){writeFileSync(process.env.TEST_CLOCK_FILE,String(Number(readFileSync(process.env.TEST_CLOCK_FILE,'utf8'))+ms));}
async function control(body){const r=await fetch(process.env.TEST_MOCK_MICROSOFT+'/test/graph',{method:'POST',body:JSON.stringify(body)});same(r.status,200);}
async function api(cookie,payload,path='/api/auth',status=200){const r=await fetch(base+path,{method:payload?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(payload?{Origin:base,'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined});const data=await r.json();same(r.status,status,JSON.stringify(data));return {data,cookie:r.headers.getSetCookie().find(c=>c.startsWith('sumatoni_session='))?.split(';')[0]};}
async function flow(mode){const start=await fetch(base+'/api/auth/entra/start',{redirect:'manual'});same(start.status,303);const external=new URL(start.headers.get('location')),url=new URL(external.pathname+external.search,process.env.TEST_MOCK_MICROSOFT);url.searchParams.set('test_mode',mode);const auth=await fetch(url,{redirect:'manual'});same(auth.status,302);return {url:auth.headers.get('location'),cookie:start.headers.getSetCookie().find(c=>c.startsWith('sumatoni_entra_flow=')).split(';')[0]};}
async function finish(f){const r=await fetch(f.url,{redirect:'manual',headers:{Cookie:f.cookie}});same(r.status,303);return {location:r.headers.get('location'),cookie:r.headers.getSetCookie().find(c=>c.startsWith('sumatoni_session='))?.split(';')[0]};}
const login=async mode=>finish(await flow(mode));
const members=()=>db.prepare('SELECT * FROM members ORDER BY id').all();
try{
 const admin=(await api(null,{action:'login',login:'admin@entra.test',password:'Entra-admin-password-2026'})).cookie;
 const baseline=members(),audit=db.prepare('SELECT count(*) n FROM entra_identity_events').get().n,accounts=db.prepare('SELECT * FROM accounts ORDER BY member_id').all();
 for(const mode of ['unknown','auto-no-email','auto-collision','auto-tenant','auto-expired','auto-signature']){
  const rejected=await login(mode);same(rejected.cookie,undefined,mode+' cannot issue a session');assert.ok(rejected.location.startsWith('/login?entra_error='));checks++;
  same(members(),baseline);same(db.prepare('SELECT count(*) n FROM entra_identity_events').get().n,audit);
 }
 const first=await flow('auto-no-role'),second=await flow('auto-wrong-role');const sessions=await Promise.all([finish(first),finish(second)]);
 for(const session of sessions)same(session.location,base+'/','Accès par défaut works without a token role');
 const a=(await api(sessions[0].cookie)).data.me,b=(await api(sessions[1].cookie)).data.me;
 same(a.id,b.id,'Concurrent logins create exactly one business identity');same(a.role,'partner');same(a.name,'Kiosk');same(a.email,'kiosk@entra.test');same(a.provider,'entra');same(a.session_object,undefined,'Internal authorization metadata never leaves the API');same(a.provisioned,undefined);
 same(members().length,baseline.length+1);same(db.prepare("SELECT count(*) n FROM entra_identity_events WHERE action='provision'").get().n,1);same(db.prepare('SELECT count(*) n FROM accounts WHERE member_id=?').get(a.id).n,0);
 const visible=(await api(sessions[0].cookie,null,'/api/time')).data;same(visible.members.length,1);same(visible.members[0].id,a.id);
 await api(sessions[0].cookie,{action:'entraLink',id:baseline[0].id,tenantId:tenant,objectId:kioskOid},'/api/auth',403);
 await api(sessions[0].cookie,{action:'account',email:'bad@entra.test',name:'Bad',password:'Not-used-password'},'/api/auth',403);
 for(const mode of ['auto-extra-admin','auto-malformed-role','auto-updated']){const s=await login(mode);const current=(await api(s.cookie)).data.me;same(current.id,a.id);same(current.role,'partner');same(current.email,'kiosk@entra.test');same(current.name,'Kiosk');}
 // A manually granted application role survives fresh Microsoft logins; old sessions never retain permissions.
 await api(admin,{action:'memberRole',id:a.id,role:'admin',expectedRole:'partner'});
 for(const session of sessions)same((await api(session.cookie)).data.me,null,'Promotion disconnects all previous Microsoft sessions');
 const promoted=await login('auto-no-role');const promotedMe=(await api(promoted.cookie)).data.me;same(promotedMe.id,a.id);same(promotedMe.role,'admin','Explicit SumaTime promotion survives a role-free Microsoft token');
 const promotedData=(await api(promoted.cookie,null,'/api/time')).data;same(promotedData.members.length,baseline.length+1,'Promoted Microsoft account can see the full team');
 await api(promoted.cookie,{action:'memberRole',id:a.id,role:'partner',expectedRole:'admin'},'/api/auth',403);
 await api(admin,{action:'memberRole',id:a.id,role:'partner',expectedRole:'admin'});
 same((await api(promoted.cookie)).data.me,null,'Demotion revokes the Microsoft administrator session');
 const demoted=await login('auto-extra-admin');same((await api(demoted.cookie)).data.me.role,'partner','Token admin claim cannot undo a local demotion');
 same((await api(demoted.cookie,null,'/api/time')).data.members.length,1,'Demoted Microsoft account sees only its own data');
 await api(demoted.cookie,{action:'memberRole',id:baseline.find(m=>m.role==='admin').id,role:'partner',expectedRole:'admin'},'/api/auth',403);
 same(db.prepare('SELECT previous_role,new_role FROM member_role_events WHERE member_id=? ORDER BY rowid').all(a.id).map(row=>({...row})),[{previous_role:'partner',new_role:'admin'},{previous_role:'admin',new_role:'partner'}]);
 sessions[0]=demoted;
 const upn=await login('auto-upn');same(upn.location,base+'/');same((await api(upn.cookie)).data.me.email,'unlicensed@entra.test','No mailbox or O365 licence needed');
 const ownerSession=await login('admin'),owner=(await api(ownerSession.cookie)).data.me;same(owner.role,'admin');same(owner.id,baseline.find(m=>m.role==='admin').id);
 // An actual recorded intervention survives every subsequent access change.
 await api(admin,{action:'client',name:'Graph preservation client'},'/api/time');const client=(await api(admin,null,'/api/time')).data.clients.find(c=>c.name==='Graph preservation client');
 const entryId=randomUUID(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 await api(sessions[0].cookie,{action:'saveEntry',id:entryId,client_id:client.id,date,ticket:'À compléter',ticket_source:'pending',glpi_ticket_id:null,start:'09:00',end:'09:16',description:'Must remain after access removal'},'/api/time');
 const saved=db.prepare('SELECT * FROM entries WHERE id=?').get(entryId);
 // A fresh login detects removal; even signed admin/partner role claims cannot bypass it.
 await control({assigned:assigned.filter(id=>id!==kioskOid)});const denied=await login('auto-extra-admin');same(denied.location,'/login?entra_error=denied');same(denied.cookie,undefined);
 tick();same((await api(sessions[0].cookie)).data.me,null,'Existing session denied after cache expiry');
 same(db.prepare('SELECT count(*) n FROM sessions WHERE member_id=?').get(a.id).n,0,'All Microsoft sessions for the removed identity revoked');
 same(db.prepare('SELECT * FROM entries WHERE id=?').get(entryId),saved);
 await control({assigned});same((await api(sessions[0].cookie)).data.me,null,'Reassigning cannot revive revoked session tokens');
 const restored=await login('auto-no-role');same((await api(restored.cookie)).data.me.id,a.id,'Reassignment reuses the original account/history');
 // A locally mapped administrator must ALSO have a real assignment.
 await control({assigned:assigned.filter(id=>id!==ownerOid)});same((await login('admin')).location,'/login?entra_error=denied');tick();same((await api(ownerSession.cookie)).data.me,null);same((await api(admin)).data.me.role,'admin','Local rescue remains available');
 await control({assigned});const recovery=await login('auto-no-role');same((await api(recovery.cookie)).data.me.id,a.id);
 // Outage: short cached read is allowed, expired cache blocks without deleting data/sessions.
 await control({offline:true});tick();const countBefore=db.prepare('SELECT count(*) n FROM sessions WHERE member_id=?').get(a.id).n;
 const unavailable=await api(recovery.cookie,null,'/api/auth',503);same(unavailable.data.code,'ENTRA_ACCESS_UNAVAILABLE');same(unavailable.data.retryable,true);same(unavailable.data.preserveOperation,true);same(unavailable.data.me,undefined,'Outage response cannot expose a member');same(db.prepare('SELECT count(*) n FROM sessions WHERE member_id=?').get(a.id).n,countBefore,'Outage is not permanent revocation');
 const blockedWrite=await api(recovery.cookie,{action:'saveEntry',id:randomUUID(),client_id:client.id,date,ticket:'À compléter',ticket_source:'pending',start:'10:00',end:'10:15',description:'No write during outage'},'/api/time',503);same(blockedWrite.data.code,'ENTRA_ACCESS_UNAVAILABLE');
 const unavailableHome=await fetch(base+'/',{headers:{Cookie:recovery.cookie},redirect:'manual'});same(unavailableHome.status,200);assert.ok((await unavailableHome.text()).includes('Votre accès est temporairement indisponible.'));checks++;
 same((await login('auto-no-role')).location,'/login?entra_error=unavailable');same(db.prepare('SELECT * FROM entries WHERE id=?').get(entryId),saved);
 await control({offline:false});tick(6001);same((await api(recovery.cookie)).data.me.id,a.id,'Same unrevoked session resumes after Graph recovery');
 await control({required:false});same((await login('auto-no-role')).location,'/login?entra_error=unavailable');tick();same((await api(recovery.cookie,null,'/api/auth',503)).data.code,'ENTRA_ACCESS_UNAVAILABLE','Misconfigured assignment requirement fails closed');
 await control({required:true});tick(6001);const finalSession=await login('auto-no-role');same((await api(finalSession.cookie)).data.me.id,a.id);
 await api(admin,{action:'memberActive',id:a.id,active:false},'/api/time');same((await api(finalSession.cookie)).data.me,null);same((await login('auto-no-role')).cookie,undefined);same(members().length,baseline.length+2);
 await api(admin,{action:'memberActive',id:a.id,active:true},'/api/time');const reenabled=await login('auto-no-role');same((await api(reenabled.cookie)).data.me.id,a.id);
 await api(admin,{action:'entraUnlink',id:a.id});same((await api(reenabled.cookie)).data.me,null);same((await login('auto-updated')).cookie,undefined,'Changed email cannot recreate explicitly unlinked identity');same(members().length,baseline.length+2);
 await api(admin,{action:'entraLink',id:a.id,tenantId:tenant,objectId:kioskOid});same((await api((await login('auto-no-role')).cookie)).data.me.id,a.id);
 for(const row of baseline)same(db.prepare('SELECT * FROM members WHERE id=?').get(row.id),row);
 same(db.prepare('SELECT * FROM accounts ORDER BY member_id').all(),accounts,'Local credentials intact');same(db.prepare('SELECT * FROM entries WHERE id=?').get(entryId),saved);
 for(const table of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
  const rows=JSON.stringify(db.prepare('SELECT * FROM "'+table.name+'"').all());
  for(const sensitive of ['graph-test-token-never-store','test-only-secret','never-store-this-token'])same(rows.includes(sensitive),false,'No provider credentials stored in '+table.name);
 }
 same(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');same(db.prepare('PRAGMA foreign_key_check').all().length,0);
 console.log(`${checks} Graph provisioning and live-session access checks passed on an isolated database.`);
}finally{db.close();writeFileSync(process.env.TEST_CLOCK_FILE,'0');}
