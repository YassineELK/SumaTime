import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {brusselsToday} from '../lib/business.ts';
const directory=mkdtempSync(join(tmpdir(),'sumatime-provider-rates-')),file=join(directory,'qa.sqlite'),url='http://127.0.0.1:8785';
const env={...process.env,DATABASE_PATH:file,SETUP_TOKEN:randomBytes(32).toString('hex'),APP_URL:url,ENTRA_ENABLED:'false',ENTRA_AUTO_PROVISION:'false',LDAP_ENABLED:'false',HOSTNAME:'127.0.0.1',PORT:'8785',NEXT_TELEMETRY_DISABLED:'1'};
const child=spawn(process.execPath,['.next/standalone/server.js'],{env,stdio:['ignore','pipe','pipe']});let logs='',db,checks=0;child.stdout.on('data',c=>logs+=c);child.stderr.on('data',c=>logs+=c);
const equal=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
async function request(path,token,payload,origin=url){const r=await fetch(url+path,{method:payload?'POST':'GET',headers:{...(token?{Cookie:'sumatoni_session='+token}:{}),...(payload?{'Content-Type':'application/json',Origin:origin}:{})},...(payload?{body:JSON.stringify(payload)}:{})});return{status:r.status,body:r.headers.get('content-type')?.includes('text/csv')?await r.text():await r.json(),cache:r.headers.get('cache-control')};}
function session(id){const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000);return token;}
try {
 for(let n=0;n<200;n++){if(child.exitCode!==null)throw Error(logs);try{if((await fetch(url+'/api/auth')).ok)break;}catch{}if(n===199)throw Error('not ready');await new Promise(r=>setTimeout(r,200));}
 db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000');
 for(const[id,role]of[['owner','admin'],['alice','partner'],['bob','partner']]){db.prepare('INSERT INTO members(id,email,name,role,active,created_at) VALUES (?,?,?,?,1,?)').run(id,id+'@example.test',id,role,'2026-01-01');db.prepare("INSERT INTO accounts VALUES (?,?,'local','hash-for-qa-only',0)").run(id,id+'@example.test');}
 db.exec("INSERT INTO clients(id,name,active,hourly_rate_cents,onsite_hourly_rate_cents,color) VALUES ('client','Client',1,98765,87654,'#123456')");
 const today=brusselsToday(),previous=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10),query=`/api/time?from=${previous}&to=${today}`;
 for(const[id,member,date,start,end,site,rate]of[['a','alice',today,540,556,1,98765],['b','alice',today,600,615,1,87654],['old','alice',previous,540,555,0,98765],['bob-entry','bob',today,540,600,0,98765]])db.prepare('INSERT INTO entries(id,member_id,client_id,ticket,date,start,end,on_site,hourly_rate_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,member,'client',id,date,start,end,site,rate,'now','now');
 db.prepare('INSERT INTO travel_days(member_id,client_id,date,fee_cents,anchor_entry_id) VALUES (?,?,?,?,?)').run('alice','client',today,2000,'a');
 // Future DB columns cannot become a new leak through SELECT e.*.
 db.exec('ALTER TABLE entries ADD COLUMN client_contract_cents INTEGER');db.exec('UPDATE entries SET client_contract_cents=7654321');
 const originalEntries=db.prepare('SELECT * FROM entries ORDER BY id').all(),originalClients=db.prepare('SELECT * FROM clients').all();
 const owner=session('owner'),alice=session('alice'),bob=session('bob'),draft={effective_from:today,hourly_rate:'50,00',version:0};
 equal((await request('/api/provider-rate',null)).status,401,'anonymous rates');
 equal((await request('/api/provider-rate',alice)).body.rates,[],'empty own rates');
 equal((await request('/api/provider-rate?member=bob',alice)).status,403,'no peer rates');
 equal((await request('/api/provider-rate',alice,{...draft,member_id:'bob'})).status,403,'cannot change peer');
 equal((await request('/api/provider-rate',alice,draft,'https://foreign.example')).status,403,'CSRF');
 equal((await request('/api/provider-rate?member=missing',owner)).status,404,'unknown target');
 for(const change of [{effective_from:'2026-02-30'},{hourly_rate:'-3'},{hourly_rate:'1.234'},{hourly_rate:50},{hourly_rate:'1000000'},{version:-1},{version:1.5}])equal((await request('/api/provider-rate',alice,{...draft,...change})).status,change.version!==undefined?409:400,'invalid rate');
 const beforeRate=(await request(query,alice)).body;equal(beforeRate.entries.every(e=>e.hourly_rate_cents===null&&e.provider_rate_cents===null),true,'no sales before own rate');
 equal(JSON.stringify(beforeRate).includes('98765'),false,'client catalog hidden');equal(JSON.stringify(beforeRate).includes('7654321'),false,'unknown contract field hidden');
 equal((await request('/api/provider-rate',alice,draft)).status,200,'own rate saved');
 equal((await request('/api/provider-rate',alice,draft)).status,409,'stale insert');
 equal((await request('/api/provider-rate',alice,{...draft,effective_from:previous,hourly_rate:'45'})).status,200,'previous period separately rated');
 let rows=(await request(query,alice)).body.entries;equal(rows.find(e=>e.id==='a').provider_rate_cents,5000,'today rate');equal(rows.find(e=>e.id==='old').provider_rate_cents,4500,'historical rate');equal(rows.some(e=>e.member_id==='bob'),false,'peer entries hidden');
 equal((await request('/api/provider-rate?member=alice',owner)).body.rates.map(r=>r.hourly_rate_cents),[5000,4500],'admin reconciliation rate');
 equal((await request('/api/provider-rate',bob)).body.rates,[],'no cross-provider fallback');
 for(const suffix of ['', '&member=bob','&client=client','&status=open','&q=a']){const r=await request(query+suffix,alice);equal(r.status,200);equal(JSON.stringify(r.body).includes('7654321'),false,'contract not returned');equal(r.body.entries.every(e=>e.hourly_rate_cents===null&&e.member_id==='alice'),true,'filtered own rows only');}
 const work=(await request('/api/workday',alice)).body;equal(work.recent.every(e=>e.hourly_rate_cents===null),true,'workday no sales');equal(JSON.stringify(work).includes('7654321'),false,'workday contract projection');equal(work.recent.find(e=>e.id==='a').provider_rate_cents,5000,'workday own rate');
 const adminState=(await request(query,owner)).body;equal(adminState.entries.find(e=>e.id==='a').hourly_rate_cents,98765,'admin retains original sale snapshot');equal(adminState.clients[0].onsite_hourly_rate_cents,87654,'admin client terms retained');
 for(const kind of ['detail','summary','partner','client']){const r=await request(query+'&client=client&export='+kind,alice);equal(r.status,200);equal(/987,65|876,54|7654321|493,83|219,14/.test(r.body),false,'no sales in '+kind);equal(r.cache,'no-store');if(kind!=='client')equal(r.body.includes('prestataire'),true,'provider labels');}
 const exportToday=await request(`/api/time?from=${today}&to=${today}&export=partner`,alice);equal(exportToday.body.split('\r\n').at(-1).endsWith('"";"37,50";"57,50"'),true,'hourly and travel total');
 equal((await request(query+'&member=alice&export=partner',owner)).body,(await request(query+'&export=partner',alice)).body,'admin and own reconciliation identical');
 equal((await request(query+'&export=detail',owner)).body.includes('987,65'),true,'admin sale export unchanged');
 const concurrent=await Promise.all(['51','52'].map(hourly_rate=>request('/api/provider-rate',alice,{...draft,hourly_rate,version:1})));equal(concurrent.map(r=>r.status).sort(),[200,409],'optimistic conflict');
 equal((await request('/api/provider-rate',alice,{...draft,hourly_rate:'',version:2})).status,200,'explicit missing rate');rows=(await request(query,alice)).body.entries;equal(rows.find(e=>e.id==='a').provider_rate_cents,null,'null does not fall back to older rate');equal(rows.find(e=>e.id==='old').provider_rate_cents,4500,'older unchanged');
 const missing=await request(`/api/time?from=${today}&to=${today}&export=partner`,alice);equal(missing.body.includes('Tarif prestataire non renseigné'),true,'missing rates flagged');equal(missing.body.split('\r\n').at(-1).endsWith('"";"";""'),true,'no false total');
 equal((await request('/api/provider-rate',alice,{...draft,hourly_rate:'0',version:3})).status,200,'zero distinct from unknown');equal((await request(query,alice)).body.entries.find(e=>e.id==='a').provider_rate_cents,0,'zero honored');
 equal(db.prepare('SELECT * FROM entries ORDER BY id').all(),originalEntries,'every existing entry and client price preserved');equal(db.prepare('SELECT * FROM clients').all(),originalClients,'client agreements untouched');
 equal(db.prepare("SELECT COUNT(*) AS n FROM provider_rate_events WHERE member_id='alice'").get().n,5,'only successful changes audited');
 db.exec("UPDATE accounts SET must_change=1 WHERE member_id='bob'");equal((await request('/api/provider-rate',bob)).status,403,'temporary password gate');
 db.exec("UPDATE members SET active=0 WHERE id='alice'");equal((await request('/api/provider-rate',alice,draft)).status,401,'inactive access denied');
 equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');equal(db.prepare('PRAGMA foreign_key_check').all(),[]);
 console.log(checks+' provider-rate/privacy API assertions passed. Isolated database only.');
}catch(error){console.error(logs);throw error;}finally{db?.close();child.kill();await new Promise(r=>child.once('exit',r));}
