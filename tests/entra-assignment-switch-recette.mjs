import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const base=process.env.TEST_URL,db=new DatabaseSync(process.env.DATABASE_PATH);let checks=0;
const same=(a,b,m)=>{assert.deepEqual(a,b,m);checks++;};
async function api(cookie,payload){const r=await fetch(base+'/api/auth',{method:payload?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(payload?{Origin:base,'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined});same(r.status,200);return {data:await r.json(),cookie:r.headers.getSetCookie().find(c=>c.startsWith('sumatoni_session='))?.split(';')[0]};}
async function login(mode){const s=await fetch(base+'/api/auth/entra/start',{redirect:'manual'});same(s.status,303);const e=new URL(s.headers.get('location')),url=new URL(e.pathname+e.search,process.env.TEST_MOCK_MICROSOFT);url.searchParams.set('test_mode',mode);const a=await fetch(url,{redirect:'manual'});same(a.status,302);const r=await fetch(a.headers.get('location'),{redirect:'manual',headers:{Cookie:s.headers.getSetCookie().find(c=>c.startsWith('sumatoni_entra_flow=')).split(';')[0]}});same(r.status,303);return {location:r.headers.get('location'),cookie:r.headers.getSetCookie().find(c=>c.startsWith('sumatoni_session='))?.split(';')[0]};}
try{
 const expected=process.env.TEST_ACCESS_SWITCH,baseline=db.prepare('SELECT * FROM members ORDER BY id').all();
 const kiosk=db.prepare('SELECT id FROM members WHERE email=?').get('kiosk@entra.test');assert.ok(kiosk);checks++;
 const existing=await login('auto-no-role');
 if(expected==='assignment'){same(existing.location,base+'/');same((await api(existing.cookie)).data.me.id,kiosk.id,'Flag off preserves existing provisioned access subject to Graph');}
 else{
  same(existing.location,'/login?entra_error=denied');same(existing.cookie,undefined,'Manual mode cannot bypass assignment checks for auto-created accounts');
  const token=db.prepare('SELECT s.token_hash FROM sessions s JOIN entra_sessions e ON e.token_hash=s.token_hash WHERE s.member_id=? LIMIT 1').get(kiosk.id);
  // Login rejection is checked above; the in-flight session check is asserted by the runner with its retained cookie.
  assert.ok(token);checks++;
 }
 same((await login('auto-new')).location,'/login?entra_error=denied','New assigned identity cannot create an account with auto provisioning disabled');
 same(db.prepare('SELECT * FROM members ORDER BY id').all(),baseline);
 const local=await api(null,{action:'login',login:'admin@entra.test',password:'Entra-admin-password-2026'});same((await api(local.cookie)).data.me.provider,'local');
 console.log(`${checks} ${expected} access-mode switch checks passed.`);
}finally{db.close();}
