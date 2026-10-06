import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { tenant, aliceOid, bobOid } from './entra-mock.mjs';
const base = process.env.TEST_URL, admin = {}, alice = {}, bob = {};
let checks = 0;
const equal = (a,b,message) => { assert.deepEqual(a,b,message); checks++; };
async function call(user, payload, path = '/api/auth', status = 200, origin = base) {
  const res = await fetch(base + path, { method: payload ? 'POST' : 'GET', headers: { ...(user?.cookie ? { Cookie: user.cookie } : {}), ...(payload ? { Origin: origin, 'Content-Type': 'application/json' } : {}) }, body: payload ? JSON.stringify(payload) : undefined });
  if (user && res.headers.getSetCookie().some(c => c.startsWith('sumatoni_session='))) user.cookie = res.headers.getSetCookie().find(c => c.startsWith('sumatoni_session=')).split(';')[0];
  const data = await res.json(); equal(res.status, status, JSON.stringify(data)); return data;
}
async function start() {
  const res = await fetch(base + '/api/auth/entra/start', { redirect: 'manual' }); equal(res.status, 303);
  equal(res.headers.get('cache-control'), 'no-store');
  const url = new URL(res.headers.get('location'));
  equal(url.origin, 'https://login.microsoftonline.com'); equal(url.searchParams.get('redirect_uri'), base + '/api/auth/entra/callback');
  equal(url.searchParams.get('scope'), 'openid profile email'); equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('nonce')); checks++;
  const cookie = res.headers.getSetCookie().find(c => c.startsWith('sumatoni_entra_flow='));
  assert.match(cookie, /HttpOnly; SameSite=Lax; Path=\/api\/auth\/entra; Max-Age=600/); checks++;
  return { url, cookie: cookie.split(';')[0] };
}
async function authorize(flow, mode) {
  const url = new URL(flow.url.pathname + flow.url.search, process.env.TEST_MOCK_MICROSOFT); if (mode) url.searchParams.set('test_mode', mode);
  const res = await fetch(url, { redirect: 'manual' }); equal(res.status, 302); return res.headers.get('location');
}
async function callback(url, cookie) {
  const res = await fetch(url, { redirect: 'manual', headers: cookie ? { Cookie: cookie } : {} }); equal(res.status, 303); equal(res.headers.get('cache-control'), 'no-store'); equal(res.headers.get('referrer-policy'),'no-referrer');
  const cookies = res.headers.getSetCookie(); assert.ok(cookies.some(c => c.startsWith('sumatoni_entra_flow=;') && c.includes('Max-Age=0'))); checks++;
  return { location: res.headers.get('location'), cookie: cookies.find(c => c.startsWith('sumatoni_session='))?.split(';')[0], response: res };
}
const status = await call(null); equal(status.entra, 'ready'); equal(status.setup, true); equal(status.entraTenantId,undefined);
const beforeSetup = await fetch(base + '/api/auth/entra/start', { redirect: 'manual' }); equal(beforeSetup.headers.get('location'), '/login?entra_error=unavailable');
await call(admin, { action:'setup', name:'Admin local', email:'admin@entra.test', password:'Entra-admin-password-2026', token:process.env.SETUP_TOKEN });
const switchRequest=await fetch(base+'/api/auth/entra/start?switch=1&redirect_uri=https://evil.test',{redirect:'manual'});equal(new URL(switchRequest.headers.get('location')).searchParams.get('prompt'),'select_account');equal(new URL(switchRequest.headers.get('location')).searchParams.get('redirect_uri'),base+'/api/auth/entra/callback');
await call(admin, { action:'account', name:'Alice', email:'alice@entra.test', password:'Entra-temporary-2026' });
await call(admin, { action:'account', name:'Bob', email:'bob@entra.test', provider:'entra', tenantId:tenant, objectId:bobOid });
const state = await call(admin, null, '/api/time'); const aliceMember = state.members.find(m => m.email === 'alice@entra.test'), bobMember = state.members.find(m => m.email === 'bob@entra.test');
equal(bobMember.provider,'entra'); equal(bobMember.entra_object_id,bobOid);
await call(null,{action:'entraLink',id:aliceMember.id,tenantId:tenant,objectId:aliceOid},'/api/auth',401);
await call(admin,{action:'entraLink',id:aliceMember.id,tenantId:'wrong',objectId:aliceOid},'/api/auth',400);
await call(admin,{action:'entraLink',id:aliceMember.id,tenantId:'77777777-7777-4777-8777-777777777777',objectId:aliceOid},'/api/auth',400);
await call(admin,{action:'entraLink',id:aliceMember.id,tenantId:tenant,objectId:aliceOid},'/api/auth',403,'https://evil.test');

await call(admin,{action:'entraLink',id:aliceMember.id,tenantId:tenant,objectId:aliceOid});
await call(admin,{action:'entraLink',id:bobMember.id,tenantId:tenant,objectId:aliceOid},'/api/auth',409);
await call(admin,{action:'account',name:'Duplicate Alice',email:'alice@entra.test',provider:'entra',tenantId:tenant,objectId:aliceOid},'/api/auth',409);
await call(admin,{action:'account',name:'Duplicate identity',email:'duplicate@entra.test',provider:'entra',tenantId:tenant,objectId:aliceOid},'/api/auth',409);
await call(admin,{action:'entraLink',id:aliceMember.id,tenantId:tenant,objectId:bobOid},'/api/auth',409);
const flow = await start(), redirect = await authorize(flow), session = await callback(redirect, flow.cookie);
equal(session.location,base+'/'); assert.ok(session.cookie); checks++; alice.cookie=session.cookie;
assert.match(session.response.headers.getSetCookie().find(c=>c.startsWith('sumatoni_session=')),/HttpOnly; SameSite=Lax; Path=\/; Max-Age=3\d{3}/); checks++;
const me = (await call(alice)).me; equal(me.id,aliceMember.id); equal(me.provider,'entra'); equal(me.name,'Alice'); equal(me.email,'alice@entra.test'); equal(me.must_change,0); equal(me.role,'partner');
const aliceState=await call(alice,null,'/api/time');equal(aliceState.members.length,1);
await call(alice,{action:'entraUnlink',id:aliceMember.id},'/api/auth',403);
await call(alice,{action:'entraLink',id:bobMember.id,tenantId:tenant,objectId:bobOid},'/api/auth',403);
await call(alice,{action:'password',current:'Entra-temporary-2026',password:'another-valid-password'},'/api/auth',400);
equal((await callback(redirect,flow.cookie)).location,'/login?entra_error=invalid');
const otherFlow=await start(), otherRedirect=await authorize(otherFlow);
equal((await callback(otherRedirect)).location,'/login?entra_error=invalid');
equal((await callback(otherRedirect,flow.cookie)).location,'/login?entra_error=invalid');
equal((await callback(otherRedirect,otherFlow.cookie)).location,base+'/','wrong browser must not consume the legitimate flow');
const badStateFlow=await start(), badStateRedirect=new URL(await authorize(badStateFlow));badStateRedirect.searchParams.set('state','a'.repeat(43));equal((await callback(badStateRedirect,badStateFlow.cookie)).location,'/login?entra_error=invalid');
for(const mode of ['tenant','issuer','audience','nonce','expired','signature','missing-oid','missing-id-token','offline','unknown','cancelled']){
 const f=await start(), r=await callback(await authorize(f,mode),f.cookie);assert.ok(r.location.startsWith('/login?entra_error='),mode+' must be rejected');checks++;equal(r.cookie,undefined,mode+' must not create a session');
}
const db=new DatabaseSync(process.env.DATABASE_PATH);
try {
 const expired=await start(), expiredRedirect=await authorize(expired);db.prepare('UPDATE entra_flows SET expires=0').run();equal((await callback(expiredRedirect,expired.cookie)).location,'/login?entra_error=invalid');
 const before=await call(admin,null,'/api/time');
 const duplicateState=await start(), duplicateRedirect=new URL(await authorize(duplicateState));duplicateRedirect.searchParams.append('state',duplicateRedirect.searchParams.get('state'));equal((await callback(duplicateRedirect,duplicateState.cookie)).location,'/login?entra_error=invalid');
 await call(admin,{action:'memberActive',id:aliceMember.id,active:false},'/api/time');equal((await call(alice)).me,null);
 const inactive=await start();equal((await callback(await authorize(inactive),inactive.cookie)).location,'/login?entra_error=denied');
 await call(admin,{action:'memberActive',id:aliceMember.id,active:true},'/api/time');
 const fresh=await start();alice.cookie=(await callback(await authorize(fresh),fresh.cookie)).cookie;
 // Even an operator removing the mapping directly cannot downgrade a Microsoft session to local.
 const mapping=db.prepare('SELECT * FROM entra_identities WHERE member_id=?').get(aliceMember.id);db.prepare('DELETE FROM entra_identities WHERE member_id=?').run(aliceMember.id);equal((await call(alice)).me,null);db.prepare('INSERT INTO entra_identities VALUES (?,?,?,?,?)').run(mapping.member_id,mapping.tenant_id,mapping.object_id,mapping.linked_by,mapping.created_at);
 await call(admin,{action:'entraUnlink',id:aliceMember.id});equal((await call(alice)).me,null);
 // Existing local authentication survives identity unlinking; temporary-password guard still applies.
 await call(alice,{action:'login',login:'alice@entra.test',password:'Entra-temporary-2026'});equal((await call(alice)).me.provider,'local');await call(alice,null,'/api/time',403);
 await call(alice,{action:'password',current:'Entra-temporary-2026',password:'Entra-alice-permanent-2026'});await call(alice,null,'/api/time');
 const bf=await start();bob.cookie=(await callback(await authorize(bf,'bob'),bf.cookie)).cookie;equal((await call(bob)).me.id,bobMember.id);
 await call(bob,{action:'login',login:'bob@entra.test',password:'fake-password'},'/api/auth',401);
 await call(admin,{action:'entraUnlink',id:bobMember.id});equal((await call(bob)).me,null);
 equal(db.prepare('SELECT COUNT(*) AS n FROM members').get().n,before.members.length);
 equal(db.prepare('SELECT COUNT(*) AS n FROM entra_flows WHERE expires<=?').get(Date.now()).n,0,'expired flows are cleared by the next login attempt');
 equal(db.prepare('PRAGMA foreign_key_check').all().length,0);equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 equal(db.prepare('SELECT COUNT(*) AS n FROM entra_identity_events').get().n,4);
 assert.ok(!JSON.stringify(db.prepare('SELECT * FROM accounts').all()).includes('test-only-secret'));checks++;
}finally{db.close();}
console.log(`${checks} Entra API checks passed on an isolated database.`);
