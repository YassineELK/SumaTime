import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
const base=process.env.TEST_URL,admin={},alice={},bob={},temporary={};let checks=0;
async function call(user,payload,path='/api/workday',expected=200,origin=base){
  const response=await fetch(base+path,{method:payload?'POST':'GET',headers:{...(user?.cookie?{Cookie:user.cookie}:{}),...(payload?{Origin:origin,'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined});
  if(user&&response.headers.get('set-cookie'))user.cookie=response.headers.get('set-cookie').split(';')[0];
  const result=await response.json();assert.equal(response.status,expected,JSON.stringify(result));checks++;return result;
}
const equal=(actual,expected)=>{assert.deepEqual(actual,expected);checks++;};
await call(null,null,'/api/workday',401);await call(null,null,'/api/glpi',401);
await call(admin,{action:'setup',name:'Admin recette',email:'provider-admin@recette.test',password:'Provider-permanent-2026',token:process.env.SETUP_TOKEN},'/api/auth');
for(const [user,email]of [[alice,'alice'],[bob,'bob'],[temporary,'temporary']]){
  await call(admin,{action:'account',name:email,email:email+'@provider.test',password:'Provider-temporary-2026'},'/api/auth');
  await call(user,{action:'login',login:email+'@provider.test',password:'Provider-temporary-2026'},'/api/auth');
  if(user!==temporary)await call(user,{action:'password',current:'Provider-temporary-2026',password:'Provider-permanent-2026'},'/api/auth');
}
await call(temporary,null,'/api/workday',403);await call(temporary,null,'/api/glpi',403);
await call(admin,{action:'client',name:'Client Alpha'},'/api/time');await call(admin,{action:'client',name:'Client Beta'},'/api/time');
const state=await call(admin,null,'/api/time'),client=state.clients.find(c=>c.name==='Client Alpha'),other=state.clients.find(c=>c.name==='Client Beta');
const aliceId=state.members.find(m=>m.email==='alice@provider.test').id;
await call(admin,{action:'clientRates',id:client.id,hourly_rate:'100',onsite_hourly_rate:'125'},'/api/time');
await call(admin,{action:'memberFee',id:aliceId,travel_fee:'25'},'/api/time');
await call(alice,{action:'clientGlpi',id:client.id,entity:4},'/api/time',403);
await call(admin,{action:'clientGlpi',id:client.id,entity:4},'/api/time');
await call(admin,{action:'clientGlpi',id:other.id,entity:4},'/api/time',400);
await call(admin,{action:'clientGlpi',id:other.id,entity:-1},'/api/time',400);
await call(admin,{action:'clientGlpi',id:other.id,entity:0},'/api/time');await call(admin,{action:'clientGlpi',id:other.id,entity:null},'/api/time');
const db=new DatabaseSync(process.env.DATABASE_PATH);db.exec('PRAGMA busy_timeout=5000');
const timer={action:'start',id:randomUUID(),client_id:client.id,ticket:'TIMER-1',description:'Travail avec reprise',on_site:true};
await call(alice,timer,'/api/workday',403,'https://foreign.invalid');
await call(alice,{...timer,on_site:'yes'},'/api/workday',400);
await call(alice,timer);await call(alice,timer);
await call(alice,{...timer,ticket:'DIFFERENT'},'/api/workday',409);
await call(alice,{...timer,id:randomUUID()},'/api/workday',409);
equal((await call(bob)).timer,null);equal((await call(admin)).timer,null);
await call(bob,{action:'stop',id:timer.id},'/api/workday',409);
await call(alice,{action:'save',id:timer.id,version:1,description:''},'/api/workday',400);
// Deterministic past interval, 2026-09-15 10:00–10:16 Brussels.
db.prepare('UPDATE work_timers SET started_at=?,stopped_at=? WHERE id=?').run(Date.parse('2026-09-15T08:00:01Z'),Date.parse('2026-09-15T08:15:20Z'),timer.id);
let work=await call(alice);equal(work.segments,[{date:'2026-09-15',start:600,end:630}]);
await call(alice,{action:'stop',id:timer.id}); // stopping twice preserves the end
equal((await call(alice)).timer.stopped_at,work.timer.stopped_at);
await call(alice,{action:'save',id:timer.id,version:9,description:''},'/api/workday',409);
await call(alice,{action:'save',id:timer.id,version:1,description:'',segments:[{date:'2026-09-14',start:'10:00',end:'10:15'}]},'/api/workday',400);
await call(alice,{action:'save',id:timer.id,version:1,description:'',segments:[{date:'2026-09-15',start:'11:00',end:'10:15'}]},'/api/workday',400);
const saved=await call(alice,{action:'save',id:timer.id,version:1,description:'Intervention vérifiée',segments:[{date:'2026-09-15',start:'10:00',end:'10:15'}]});
equal((await call(alice,{action:'save',id:timer.id,version:1,description:'Intervention vérifiée'})).entry_ids,saved.entry_ids);
equal((await call(alice)).timer,null);
let entry=db.prepare('SELECT * FROM entries WHERE id=?').get(saved.entry_ids[0]);equal(entry.end-entry.start,15);equal(entry.hourly_rate_cents,12500);
equal(db.prepare('SELECT fee_cents FROM travel_days WHERE member_id=?').get(aliceId).fee_cents,2500);
equal((await call(alice)).recent[0].hourly_rate_cents,null);
equal((await call(bob)).recent,[]);
await call(alice,timer,'/api/workday',409);
// Overlap retains the timer and rolls back all segments atomically.
const second={...timer,id:randomUUID(),ticket:'OVERLAP'};await call(alice,second);
db.prepare('UPDATE work_timers SET started_at=?,stopped_at=? WHERE id=?').run(Date.parse('2026-09-15T08:05:00Z'),Date.parse('2026-09-15T08:20:00Z'),second.id);
await call(alice,{action:'save',id:second.id,version:1,description:''},'/api/workday',409);equal((await call(alice)).timer.id,second.id);
await call(alice,{action:'discard',id:second.id,version:2},'/api/workday',409);await call(alice,{action:'discard',id:second.id,version:1});
const midnight={...timer,id:randomUUID(),ticket:'MIDNIGHT'};await call(alice,midnight);
db.prepare('UPDATE work_timers SET started_at=?,stopped_at=? WHERE id=?').run(Date.parse('2026-09-13T21:45:00Z'),Date.parse('2026-09-13T22:15:00Z'),midnight.id);
const split=await call(alice,{action:'save',id:midnight.id,version:1,description:'Deux journées'});equal(split.entry_ids.length,2);
equal(db.prepare('SELECT COUNT(*) AS n FROM travel_days WHERE member_id=?').get(aliceId).n,3);
// Personal GLPI credentials and permission isolation.
equal((await call(alice,null,'/api/glpi')).connected,false);
await call(alice,null,'/api/glpi?tickets=1',409);
await call(alice,{action:'connect',token:'invalid-token'},'/api/glpi',502);
await call(alice,{action:'connect',token:'alice-test-token'},'/api/glpi',403,'https://foreign.invalid');
await call(alice,{action:'connect',token:'alice-test-token'},'/api/glpi');
equal((await call(bob,null,'/api/glpi')).connected,false);
equal((await call(alice,null,'/api/glpi')).connected,true);
equal(existsSync(join(dirname(process.env.DATABASE_PATH),'glpi-key')),true);
const stored=db.prepare('SELECT encrypted_token FROM glpi_credentials WHERE member_id=?').get(aliceId).encrypted_token;equal(stored.includes('alice-test-token'),false);
let list=await call(alice,null,'/api/glpi?tickets=1');equal(list.tickets.length,10);equal(list.total,12);equal(list.tickets[0].client_id,client.id);equal(list.tickets[1].client_id,null);
equal(list.tickets[0].url.endsWith('/front/ticket.form.php?id=101'),true);
list=await call(alice,null,'/api/glpi?tickets=1&page=1');equal(list.tickets.length,2);
list=await call(alice,null,'/api/glpi?tickets=1&q=VPN');equal(list.tickets.length,1);equal(list.tickets[0].id,101);
list=await call(alice,null,'/api/glpi?tickets=1&q=103&open=false');equal(list.tickets[0].id,103);
equal((await call(alice,null,'/api/glpi?tickets=1&q=absent')).tickets,[]);
await call(alice,null,'/api/glpi?tickets=1&page=-1',400);
await call(bob,{action:'connect',token:'bob-test-token'},'/api/glpi');list=await call(bob,null,'/api/glpi?tickets=1');equal(list.total,1);equal(list.tickets[0].id,102);
await call(alice,{action:'disconnect'},'/api/glpi');equal((await call(alice,null,'/api/glpi')).connected,false);equal((await call(bob,null,'/api/glpi')).connected,true);
await call(alice,{action:'connect',token:'broken-test-token'},'/api/glpi');await call(alice,null,'/api/glpi?tickets=1',502);
await call(alice,{action:'connect',token:'redirect-test-token'},'/api/glpi');await call(alice,null,'/api/glpi?tickets=1',502);
await call(alice,{action:'connect',token:'slow-test-token'},'/api/glpi');const before=Date.now();await call(alice,null,'/api/glpi?tickets=1',502);assert(Date.now()-before<18500);checks++;
await call(alice,{action:'connect',token:'alice-test-token'},'/api/glpi');
// Credential binding prevents reusing a ciphertext for another member.
db.prepare('UPDATE glpi_credentials SET encrypted_token=? WHERE member_id=?').run(db.prepare('SELECT encrypted_token FROM glpi_credentials WHERE member_id=?').get(aliceId).encrypted_token,state.members.find(m=>m.email==='bob@provider.test').id);
await call(bob,null,'/api/glpi?tickets=1',409);
db.prepare('UPDATE glpi_credentials SET api_url=? WHERE member_id=?').run('https://different-glpi.invalid/apirest.php',aliceId);
equal((await call(alice,null,'/api/glpi')).connected,false);await call(alice,null,'/api/glpi?tickets=1',409);
// A midnight conflict on day two must not leave an entry on day one.
const atomic={...timer,id:randomUUID(),ticket:'ATOMIC-ROLLBACK'};await call(alice,atomic);
db.prepare('UPDATE work_timers SET started_at=?,stopped_at=? WHERE id=?').run(Date.parse('2026-09-13T21:50:00Z'),Date.parse('2026-09-13T22:10:00Z'),atomic.id);
const countBefore=db.prepare('SELECT COUNT(*) AS n FROM entries').get().n;
await call(alice,{action:'save',id:atomic.id,version:1,description:'',segments:[{date:'2026-09-13',start:'20:00',end:'20:15'},{date:'2026-09-14',start:'00:00',end:'00:10'}]},'/api/workday',409);
equal(db.prepare('SELECT COUNT(*) AS n FROM entries').get().n,countBefore);equal((await call(alice)).timer.id,atomic.id);
await call(alice,{action:'discard',id:atomic.id,version:1});
// Explicit creation uses personal rights, preserves client/entity and prevents replay.
await call(alice,{action:'connect',token:'alice-test-token'},'/api/glpi');
await call(bob,{action:'connect',token:'bob-test-token'},'/api/glpi');
const creation={action:'createTicket',request_id:randomUUID(),client_id:client.id,title:'Ticket depuis Sumatime',description:'Description <script>safe</script>',type:1,urgency:3,category:1};
const opts=await call(alice,null,'/api/glpi?createOptions=1&client='+client.id);equal(opts.categories[0].id,1);
await call(alice,{action:'connect',token:'entity-false-test-token'},'/api/glpi');
const entityFalseRequestId=randomUUID();
await call(alice,{...creation,request_id:entityFalseRequestId,title:'ENTITY-CONTEXT-FALSE'},'/api/glpi',502);
equal(db.prepare('SELECT COUNT(*) AS n FROM glpi_creations WHERE request_id=?').get(entityFalseRequestId).n,0);
for (const token of ['entity-http-error-test-token', 'entity-malformed-test-token']) {
  await call(alice,{action:'connect',token},'/api/glpi');
  await call(alice,null,'/api/glpi?createOptions=1&client='+client.id,502);
}
await call(alice,{action:'connect',token:'alice-test-token'},'/api/glpi');
await call(bob,{...creation,request_id:randomUUID()},'/api/glpi',403);
await call(alice,{...creation,request_id:randomUUID()},'/api/glpi',403,'https://foreign.invalid');
await call(alice,{...creation,request_id:randomUUID(),title:''},'/api/glpi',400);
const made=await call(alice,creation,'/api/glpi');equal(made.ticket.client_id,client.id);equal(made.ticket.entity,4);
equal((await call(alice,creation,'/api/glpi')).ticket.id,made.ticket.id);
await call(alice,{...creation,title:'Changed payload'},'/api/glpi',409);
const rejected={...creation,request_id:randomUUID(),title:'REJECT-CREATE'};await call(alice,rejected,'/api/glpi',422);
equal(db.prepare('SELECT COUNT(*) AS n FROM glpi_creations WHERE request_id=?').get(rejected.request_id).n,0);
const uncertain={...creation,request_id:randomUUID(),title:'UNCERTAIN-CREATE'};
equal((await call(alice,uncertain,'/api/glpi',409)).uncertain,true);
equal((await call(alice,uncertain,'/api/glpi',409)).uncertain,true);
const concurrent={...creation,request_id:randomUUID(),title:'CONCURRENT-CREATE'};
const simultaneous=await Promise.all([1,2].map(()=>fetch(base+'/api/glpi',{method:'POST',headers:{Cookie:alice.cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify(concurrent)})));
equal(simultaneous.map(r=>r.status).sort(),[200,409]);await Promise.all(simultaneous.map(r=>r.arrayBuffer()));
// A second on-site timer on the same client/day does not create a second trip.
const daily={...timer,id:randomUUID(),ticket:'DAILY-FEE'};await call(alice,daily);
db.prepare('UPDATE work_timers SET started_at=?,stopped_at=? WHERE id=?').run(Date.parse('2026-09-15T09:00:00Z'),Date.parse('2026-09-15T09:15:00Z'),daily.id);
await call(alice,{action:'save',id:daily.id,version:1,description:''});equal(db.prepare('SELECT COUNT(*) AS n FROM travel_days WHERE member_id=?').get(aliceId).n,3);
const beforeBackups=new Set(existsSync('backups') ? readdirSync('backups') : []);
const backup=spawnSync(process.execPath,['scripts/backup.mjs'],{env:process.env,encoding:'utf8'});equal(backup.status,0);
const createdBackup=readdirSync('backups').find(f=>!beforeBackups.has(f)&&f.endsWith('.sqlite'));assert(createdBackup);checks++;
equal(readFileSync(join('backups',createdBackup+'.glpi-key')).equals(readFileSync(join(dirname(process.env.DATABASE_PATH),'glpi-key'))),true);
db.close();console.log(`Provider acceptance: ${checks} assertions passed.`);
