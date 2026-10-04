import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mockGlpi } from './glpi-mock.mjs';
const runtimeRoot=process.env.QA_RUNTIME_ROOT || '.sites-runtime';mkdirSync(runtimeRoot,{recursive:true});const directory=mkdtempSync(resolve(runtimeRoot,'provider-qa-'));
const env={...process.env,DATABASE_PATH:resolve(directory,'qa.sqlite'),SETUP_TOKEN:randomBytes(32).toString('hex'),APP_URL:'http://127.0.0.1:8787',TEST_URL:'http://127.0.0.1:8787',LDAP_ENABLED:'false',GLPI_API_URL:'http://127.0.0.1:8790/apirest.php',GLPI_APP_TOKEN:'mock-app-token',GLPI_WRITE_ENABLED:'true',NEXT_TELEMETRY_DISABLED:'1'};
const raceCleanupCounts=new Map();
const mock=await mockGlpi(8790,[4,9],{onSessionCleanup(user){if(!user?.startsWith('race-'))return;const count=(raceCleanupCounts.get(user)||0)+1;raceCleanupCounts.set(user,count);if(count!==2)return;const db=new DatabaseSync(env.DATABASE_PATH);try{if(user==='race-archive-test-token')db.prepare('UPDATE clients SET active=0 WHERE glpi_entity_id=4').run();else db.prepare('UPDATE clients SET glpi_entity_id=9 WHERE glpi_entity_id=4').run();}finally{db.close();}}});const serverArgs=existsSync('.next/standalone/server.js')?['.next/standalone/server.js']:['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','8787'];const child=spawn(process.execPath,serverArgs,{env:{...env,HOSTNAME:'127.0.0.1',PORT:'8787'},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
try{
  let ready=false;for(let i=0;i<400;i++){if(child.exitCode!==null)throw new Error(logs);try{if((await fetch(env.TEST_URL+'/api/auth')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,300));}
  if(!ready)throw new Error(logs);
  const test=spawn(process.execPath,['tests/provider-recette.mjs'],{env,stdio:'inherit'});const code=await new Promise(r=>test.on('exit',r));if(code!==0){console.error(logs);process.exitCode=1;}
  assert.equal(mock.sessions.size,0,'All GLPI sessions should be closed');assert(mock.calls.every(c=>c.method==='GET'||(c.method==='POST'&&['Ticket','changeActiveEntities'].includes(c.path))),'Only explicit ticket creation and temporary entity selection may mutate GLPI');const ticketCalls=mock.calls.filter(c=>c.method==='POST'&&c.path==='Ticket');assert.equal(ticketCalls.length,4,'Three provider attempts are accepted/replayed safely and one explicit provider refusal is retained');assert.equal(ticketCalls.filter(call=>call.body?.input?.name==='CONCURRENT-CREATE').length,1,'Fingerprint-concurrent requests must emit one provider Ticket POST');assert(ticketCalls.every(call=>call.user==='alice-test-token'),'Every accepted Ticket POST must use Alice\'s personal GLPI session');console.log('GLPI sessions closed; allowed operations, member identity and creation counts verified.');
}finally{child.kill();mock.server.closeAllConnections();mock.server.close();}
