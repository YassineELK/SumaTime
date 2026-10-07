import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { tenant } from './entra-mock.mjs';
const base = process.env.TEST_URL;
const db = new DatabaseSync(process.env.DATABASE_PATH);
const kioskOid = '88888888-8888-4888-8888-888888888888';
let checks = 0;
function same(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
async function api(cookie, payload, path='/api/auth', status=200) {
 const res=await fetch(base+path,{method:payload?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(payload?{Origin:base,'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined});
 const data=await res.json();same(res.status,status,JSON.stringify(data));return {data,cookie:res.headers.getSetCookie().find(c=>c.startsWith('sumatoni_session='))?.split(';')[0]};
}
async function flow(mode) {
 const start=await fetch(base+'/api/auth/entra/start',{redirect:'manual'});same(start.status,303);
 const external=new URL(start.headers.get('location'));const url=new URL(external.pathname+external.search,process.env.TEST_MOCK_MICROSOFT);url.searchParams.set('test_mode',mode);
 const auth=await fetch(url,{redirect:'manual'});same(auth.status,302);
 return {url:auth.headers.get('location'),cookie:start.headers.getSetCookie().find(c=>c.startsWith('sumatoni_entra_flow=')).split(';')[0]};
}
async function finish(f) {
 const res=await fetch(f.url,{redirect:'manual',headers:{Cookie:f.cookie}});same(res.status,303);
 return {location:res.headers.get('location'),cookie:res.headers.getSetCookie().find(c=>c.startsWith('sumatoni_session='))?.split(';')[0]};
}
async function login(mode) { return finish(await flow(mode)); }
function existing() { return db.prepare('SELECT * FROM members ORDER BY id').all(); }
const admin=(await api(null,{action:'login',login:'admin@entra.test',password:'Entra-admin-password-2026'})).cookie;
const baseline=existing(), audit=db.prepare('SELECT count(*) n FROM entra_identity_events').get().n;
try {
 for(const mode of ['auto-no-role','auto-wrong-role','auto-malformed-role','auto-no-email','auto-collision','auto-tenant','auto-expired','auto-signature']) {
  const rejected=await login(mode);same(rejected.cookie,undefined,mode+' cannot issue a session');assert.ok(rejected.location.startsWith('/login?entra_error='));checks++;
  same(existing(),baseline,mode+' cannot create or alter a business member');
  same(db.prepare('SELECT count(*) n FROM entra_identity_events').get().n,audit,'Failed attempts leave no audit or partial registration');
 }
 const first=await flow('auto-extra-admin'),second=await flow('auto');
 const sessions=await Promise.all([finish(first),finish(second)]);
 for(const session of sessions) same(session.location,base+'/');
 const a=(await api(sessions[0].cookie)).data.me,b=(await api(sessions[1].cookie)).data.me;
 same(a.id,b.id,'Concurrent first logins share one stable member');same(a.role,'partner','An extra admin claim never elevates the new member');same(a.name,'Kiosk');same(a.email,'kiosk@entra.test');same(a.provider,'entra');
 same(existing().length,baseline.length+1);
 same(db.prepare('SELECT count(*) n FROM entra_identity_events WHERE action=?').get('provision').n,1,'Only one automatic provisioning audit');
 same(db.prepare('SELECT count(*) n FROM entra_provisioned_members WHERE member_id=?').get(a.id).n,1);
 same(db.prepare('SELECT count(*) n FROM accounts WHERE member_id=?').get(a.id).n,0,'Microsoft-only user needs no local password');
 same(db.prepare('SELECT object_id FROM entra_identities WHERE member_id=?').get(a.id).object_id,kioskOid);
 const visible=(await api(sessions[0].cookie,null,'/api/time')).data;same(visible.members.length,1,'Partner cannot see the admin or other members');same(visible.members[0].id,a.id);
 await api(sessions[0].cookie,{action:'entraLink',id:baseline[0].id,tenantId:tenant,objectId:kioskOid},'/api/auth',403);
 await api(sessions[0].cookie,{action:'account',email:'bad@entra.test',name:'Bad',password:'Not-used-password'},'/api/auth',403);
 const changed=await login('auto-updated');same((await api(changed.cookie)).data.me.email,'kiosk@entra.test');same((await api(changed.cookie)).data.me.name,'Kiosk','Display claims do not rewrite the existing profile');
 same((await login('auto-no-role')).cookie,undefined,'An auto-created user must retain the app role at the next login');
 const upn=await login('auto-upn');same(upn.location,base+'/');const noMail=(await api(upn.cookie)).data.me;same(noMail.email,'unlicensed@entra.test');same(noMail.role,'partner','No email claim/mailbox is required if the UPN is present');
 await api(admin,{action:'memberActive',id:a.id,active:false},'/api/time');same((await api(sessions[0].cookie)).data.me,null);same((await login('auto')).cookie,undefined,'Disabled member cannot be recreated');same(existing().length,baseline.length+2);
 await api(admin,{action:'memberActive',id:a.id,active:true},'/api/time');const again=await login('auto');same((await api(again.cookie)).data.me.id,a.id);
 await api(admin,{action:'entraUnlink',id:a.id});same((await api(again.cookie)).data.me,null);
 same((await login('auto-updated')).cookie,undefined,'An explicitly unlinked identity cannot be recreated with a changed email');same(existing().length,baseline.length+2);
 await api(admin,{action:'entraLink',id:a.id,tenantId:tenant,objectId:kioskOid});const restored=await login('auto');same((await api(restored.cookie)).data.me.id,a.id,'Explicit admin relinking preserves the original history');
 for(const row of baseline)same(db.prepare('SELECT * FROM members WHERE id=?').get(row.id),row,'All pre-existing identities and roles preserved');
 same(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');same(db.prepare('PRAGMA foreign_key_check').all().length,0);
 same((await api(admin)).data.me.role,'admin','Local rescue access remains available');
 console.log(`${checks} automatic Entra provisioning checks passed on an isolated database.`);
} finally { db.close(); }
