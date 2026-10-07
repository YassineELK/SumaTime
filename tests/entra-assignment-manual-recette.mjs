import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { tenant, aliceOid } from './entra-mock.mjs';
const base=process.env.TEST_URL,db=new DatabaseSync(process.env.DATABASE_PATH);let checks=0;
const same=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
async function api(cookie,payload,path='/api/auth',status=200){const r=await fetch(base+path,{method:payload?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(payload?{Origin:base,'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined});const data=await r.json();same(r.status,status,JSON.stringify(data));return {data,cookie:r.headers.getSetCookie().find(c=>c.startsWith('sumatoni_session='))?.split(';')[0]};}
async function login(mode){const start=await fetch(base+'/api/auth/entra/start',{redirect:'manual'});same(start.status,303);const external=new URL(start.headers.get('location')),url=new URL(external.pathname+external.search,process.env.TEST_MOCK_MICROSOFT);url.searchParams.set('test_mode',mode);const auth=await fetch(url,{redirect:'manual'});same(auth.status,302);const result=await fetch(auth.headers.get('location'),{redirect:'manual',headers:{Cookie:start.headers.getSetCookie().find(c=>c.startsWith('sumatoni_entra_flow=')).split(';')[0]}});same(result.status,303);return {location:result.headers.get('location'),cookie:result.headers.getSetCookie().find(c=>c.startsWith('sumatoni_session='))?.split(';')[0]};}
try{
 const admin=(await api(null,{action:'login',login:'admin@entra.test',password:'Entra-admin-password-2026'})).cookie;
 const owner=db.prepare("SELECT id FROM members WHERE role='admin'").get().id,alice=db.prepare('SELECT id FROM members WHERE email=?').get('alice@entra.test').id;
 await api(admin,{action:'entraLink',id:owner,tenantId:tenant,objectId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'});
 await api(admin,{action:'entraLink',id:alice,tenantId:tenant,objectId:aliceOid});
 const baseline=db.prepare('SELECT * FROM members ORDER BY id').all();
 const approved=await login('admin');same(approved.location,base+'/');const me=(await api(approved.cookie)).data.me;same(me.id,owner);same(me.role,'admin','Existing app role is preserved');
 const user=await login('ok');same((await api(user.cookie)).data.me.id,alice);
 const unknown=await login('auto-no-role');same(unknown.location,'/login?entra_error=denied');same(unknown.cookie,undefined,'An assigned unknown user cannot create a member with auto provisioning disabled');
 same(db.prepare('SELECT * FROM members ORDER BY id').all(),baseline);
 same((await api(admin)).data.me.provider,'local');console.log(`${checks} assignment-mode checks with automatic creation disabled passed.`);
}finally{db.close();}
