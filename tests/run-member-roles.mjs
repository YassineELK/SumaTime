import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const runtimeRoot=process.env.QA_RUNTIME_ROOT||'/tmp/sumatime-roles-api';mkdirSync(runtimeRoot,{recursive:true});
const directory=mkdtempSync(resolve(runtimeRoot,'qa-'));const file=resolve(directory,'qa.sqlite'),url='http://127.0.0.1:8786';
const env={...process.env,DATABASE_PATH:file,SETUP_TOKEN:randomBytes(32).toString('hex'),APP_URL:url,ENTRA_ENABLED:'false',ENTRA_AUTO_PROVISION:'false',LDAP_ENABLED:'false',HOSTNAME:'127.0.0.1',PORT:'8786',NEXT_TELEMETRY_DISABLED:'1'};
const child=spawn(process.execPath,['.next/standalone/server.js'],{env,stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',c=>logs+=c);child.stderr.on('data',c=>logs+=c);
let db,checks=0;
async function request(path,token,payload,origin=url){const response=await fetch(url+path,{method:payload?'POST':'GET',headers:{...(token?{Cookie:'sumatoni_session='+token}:{}),...(payload?{'Content-Type':'application/json',Origin:origin}:{})},...(payload?{body:JSON.stringify(payload)}:{})});return{status:response.status,body:await response.json()};}
function session(id){const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000);return token;}
function equal(a,b,message){assert.deepEqual(a,b,message);checks++;}
try{
 for(let n=0;n<200;n++){if(child.exitCode!==null)throw Error(logs);try{if((await fetch(url+'/api/auth')).ok)break;}catch{}if(n===199)throw Error('not ready');await new Promise(r=>setTimeout(r,200));}
 db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000');
 for(const [id,role]of[['owner','admin'],['alice','partner'],['bob','partner'],['other','admin']]){
  db.prepare('INSERT INTO members(id,email,name,role,active,created_at) VALUES (?,?,?,?,1,?)').run(id,id+'@example.test',id,role,'2026-01-01');
  db.prepare("INSERT INTO accounts VALUES (?,?,'local','hash-for-qa-only',0)").run(id,id+'@example.test');
 }
 db.prepare("INSERT INTO clients(id,name,active) VALUES ('client','Client',1)").run();
 for(const id of ['alice','bob'])db.prepare('INSERT INTO entries(id,member_id,client_id,ticket,date,start,end,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('entry-'+id,id,'client','Historical','2026-01-02',540,600,'now','now');
 const before=db.prepare('SELECT * FROM entries ORDER BY id').all();
 const owner=session('owner'),alice=session('alice'),other=session('other');
 const promotion={action:'memberRole',id:'alice',role:'admin',expectedRole:'partner'};
 equal((await request('/api/auth',null,promotion)).status,401,'anonymous');
 equal((await request('/api/auth',alice,promotion)).status,403,'partner cannot self elevate');
 equal((await request('/api/auth',alice,{...promotion,id:'bob'})).status,403,'partner cannot elevate someone else');
 equal((await request('/api/auth',owner,promotion,'https://foreign.example')).status,403,'CSRF');
 equal((await request('/api/auth',owner,{...promotion,role:'superadmin'})).status,400,'invalid role');
 equal((await request('/api/auth',owner,{...promotion,id:'missing'})).status,404,'missing member');
 equal((await request('/api/auth',owner,{...promotion,id:'owner',role:'partner',expectedRole:'admin'})).status,403,'self change');
 equal((await request('/api/time?from=2026-01-01&to=2026-01-31',alice)).body.entries.length,1,'own entries before promotion');
 equal((await request('/api/auth',owner,promotion)).status,200,'promotion allowed');
 equal((await request('/api/auth',alice)).body.me,null,'old partner session revoked');
 equal((await request('/api/time',alice)).status,401,'revoked session cannot access entries');
 equal((await request('/api/auth',owner,promotion)).status,409,'stale UI');
 const newAdmin=session('alice');equal((await request('/api/auth',newAdmin)).body.me.role,'admin','new login receives admin role');
 equal((await request('/api/time?from=2026-01-01&to=2026-01-31',newAdmin)).body.entries.length,2,'new admin sees all entries');
 equal((await request('/api/auth',owner,{...promotion,role:'partner',expectedRole:'admin'})).status,200,'demotion');
 equal((await request('/api/time',newAdmin)).status,401,'old admin session revoked');
 const newPartner=session('alice');equal((await request('/api/auth',newPartner)).body.me.role,'partner','new login receives partner');
 equal((await request('/api/time?from=2026-01-01&to=2026-01-31',newPartner)).body.entries.length,1,'new partner sees own data only');
 equal((await request('/api/auth',newPartner,{...promotion,id:'bob'})).status,403,'demoted admin cannot assign roles');
 equal(db.prepare('SELECT * FROM entries ORDER BY id').all(),before,'billing data unchanged');
 equal(db.prepare('SELECT actor_id,member_id,previous_role,new_role FROM member_role_events ORDER BY rowid').all().map(r=>({...r})),[{actor_id:'owner',member_id:'alice',previous_role:'partner',new_role:'admin'},{actor_id:'owner',member_id:'alice',previous_role:'admin',new_role:'partner'}],'audit');
 db.exec("UPDATE members SET active=0 WHERE id='bob'");equal((await request('/api/auth',owner,{...promotion,id:'bob'})).status,409,'inactive target');
 db.exec("UPDATE accounts SET provider='ldap' WHERE member_id='other'");equal((await request('/api/auth',other,{...promotion,id:'owner',role:'partner',expectedRole:'admin'})).status,409,'last local rescue protected');
 equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');equal(db.prepare('PRAGMA foreign_key_check').all(),[]);
 console.log(checks+' role API assertions passed. Isolated database only.');
} catch(error){console.error(logs);throw error;}
finally{db?.close();child.kill();await new Promise(r=>child.once('exit',r));}
