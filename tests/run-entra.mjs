import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mockMicrosoft, tenant, clientId, aliceOid } from './entra-mock.mjs';
const runtimeRoot = process.env.QA_RUNTIME_ROOT || '.sites-runtime';
mkdirSync(runtimeRoot, { recursive: true });
const directory = mkdtempSync(resolve(runtimeRoot, 'entra-qa-'));
const clockFile=resolve(directory,'clock');writeFileSync(clockFile,'0');
const mock = await mockMicrosoft();
const env = { ...process.env, DATABASE_PATH: resolve(directory, 'qa.sqlite'), SETUP_TOKEN: randomBytes(32).toString('hex'),
  APP_URL: 'http://127.0.0.1:8788', TEST_URL: 'http://127.0.0.1:8788', LDAP_ENABLED: 'false',
  ENTRA_ENABLED: 'true', ENTRA_ACCESS_MODE: 'manual', ENTRA_AUTO_PROVISION: 'false', TEST_CLOCK_FILE: clockFile, ENTRA_TENANT_ID: tenant, ENTRA_CLIENT_ID: clientId, ENTRA_CLIENT_SECRET: 'test-only-secret', ENTRA_SESSION_MINUTES: '60',
  TEST_MOCK_MICROSOFT: 'http://127.0.0.1:8791', NEXT_TELEMETRY_DISABLED: '1',
  NODE_OPTIONS: `--import=${resolve('tests/entra-fetch-shim.mjs')}` };
let child = spawn(process.execPath, ['.next/standalone/server.js'], { env: { ...env, HOSTNAME: '127.0.0.1', PORT: '8788' }, stdio: ['ignore','pipe','pipe'] });
let logs = '';
child.stdout.on('data', x => logs += x); child.stderr.on('data', x => logs += x);
try {
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null) throw new Error(logs);
    try { if ((await fetch(env.TEST_URL + '/api/auth')).ok) { ready = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 300));
  }
  if (!ready) throw new Error('QA server did not start: ' + logs);
  const test = spawn(process.execPath, ['tests/entra-recette.mjs'], { env: { ...env, NODE_OPTIONS: '' }, stdio: 'inherit' });
  const code = await new Promise(r => test.once('exit', r));
  assert.equal(code, 0, logs);
  assert.ok(mock.calls.some(c => c.path.endsWith('/keys')), 'ID token signature must be checked against JWKS');
  assert.ok(!logs.includes('test-only-secret') && !logs.includes('never-store-this-token') && !logs.includes('graph-test-token-never-store'), 'No credential/token in server logs');
  console.log('Microsoft simulator: PKCE, client authentication and JWKS verified; no provider tokens in logs.');
  const exited = new Promise(r => child.once('exit', r)); child.kill(); await exited;
  child = spawn(process.execPath, ['.next/standalone/server.js'], { env: { ...env, ENTRA_ACCESS_MODE: 'assignment', ENTRA_AUTO_PROVISION: 'false', HOSTNAME:'127.0.0.1', PORT:'8788' }, stdio:['ignore','pipe','pipe'] });
  child.stdout.on('data', x => logs += x); child.stderr.on('data', x => logs += x);
  let manualReady=false;for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error(logs);try{if((await fetch(env.TEST_URL+'/api/auth')).ok){manualReady=true;break;}}catch{}await new Promise(r=>setTimeout(r,300));}assert.ok(manualReady);
  const manualTest=spawn(process.execPath,['tests/entra-assignment-manual-recette.mjs'],{env:{...env,NODE_OPTIONS:''},stdio:'inherit'});
  assert.equal(await new Promise(r=>manualTest.once('exit',r)),0,logs);
  const manualStopped=new Promise(r=>child.once('exit',r));child.kill();await manualStopped;
  child = spawn(process.execPath, ['.next/standalone/server.js'], { env: { ...env, ENTRA_ACCESS_MODE: 'assignment', ENTRA_AUTO_PROVISION: 'true', HOSTNAME: '127.0.0.1', PORT: '8788' }, stdio: ['ignore','pipe','pipe'] });
  child.stdout.on('data', x => logs += x); child.stderr.on('data', x => logs += x);
  let provisionReady = false;
  for (let i = 0; i < 120; i++) { if (child.exitCode !== null) throw new Error(logs); try { if ((await fetch(env.TEST_URL + '/api/auth')).ok) { provisionReady = true; break; } } catch {} await new Promise(r => setTimeout(r, 300)); }
  assert.ok(provisionReady, 'Provisioning QA server ready');
  const provisionTest = spawn(process.execPath, ['tests/entra-provision-recette.mjs'], { env: { ...env, NODE_OPTIONS: '' }, stdio: 'inherit' });
  assert.equal(await new Promise(r => provisionTest.once('exit', r)), 0, logs);
  assert.ok(!logs.includes('graph-test-token-never-store') && !logs.includes('test-only-secret'), 'Graph bearer and client secret absent from logs');
  const provisionStopped = new Promise(r => child.once('exit', r)); child.kill(); await provisionStopped;
  let retainedAutoCookie;
  for (const mode of ['assignment','manual']) {
    const callsBefore=mock.calls.length;
    child=spawn(process.execPath,['.next/standalone/server.js'],{env:{...env,ENTRA_ACCESS_MODE:mode,ENTRA_AUTO_PROVISION:'false',HOSTNAME:'127.0.0.1',PORT:'8788'},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
    let ready=false;for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error(logs);try{if((await fetch(env.TEST_URL+'/api/auth')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,300));}assert.ok(ready);
    const switchTest=spawn(process.execPath,['tests/entra-assignment-switch-recette.mjs'],{env:{...env,TEST_ACCESS_SWITCH:mode,NODE_OPTIONS:''},stdio:'inherit'});
    assert.equal(await new Promise(r=>switchTest.once('exit',r)),0,logs);
    if(mode==='assignment') {
      const start=await fetch(env.TEST_URL+'/api/auth/entra/start',{redirect:'manual'}),external=new URL(start.headers.get('location')),authorize=new URL(external.pathname+external.search,env.TEST_MOCK_MICROSOFT);authorize.searchParams.set('test_mode','auto-no-role');
      const auth=await fetch(authorize,{redirect:'manual'}),callback=await fetch(auth.headers.get('location'),{redirect:'manual',headers:{Cookie:start.headers.getSetCookie().find(c=>c.startsWith('sumatoni_entra_flow=')).split(';')[0]}});
      retainedAutoCookie=callback.headers.getSetCookie().find(c=>c.startsWith('sumatoni_session=')).split(';')[0];
    }else{
      const me=await fetch(env.TEST_URL+'/api/auth',{headers:{Cookie:retainedAutoCookie}}).then(r=>r.json());assert.equal(me.me,null,'Retained automatic member session blocked in manual mode');
      assert.ok(!mock.calls.slice(callsBefore).some(c=>c.path.startsWith('/graph/')),'Manual mode never contacts Graph');
    }
    const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;
  }
  const db = new DatabaseSync(env.DATABASE_PATH), token = randomBytes(32).toString('hex');
  const alice = db.prepare('SELECT id FROM members WHERE email=?').get('alice@entra.test').id;
  const owner = db.prepare('SELECT id FROM members WHERE role=?').get('admin').id;
  const hash = createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT OR IGNORE INTO entra_identities VALUES (?,?,?,?,?)').run(alice,tenant,aliceOid,owner,new Date().toISOString());
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash,alice,Date.now()+3600000);
  db.prepare('INSERT INTO entra_sessions VALUES (?,?,?)').run(hash,tenant,aliceOid);db.close();
  const providerCalls = mock.calls.length;
  for (const [status, overrides] of [
    ['disabled',{ENTRA_ENABLED:'false'}],
    ['incomplete',{ENTRA_CLIENT_SECRET:''}],
    ['ready',{ENTRA_TENANT_ID:'77777777-7777-4777-8777-777777777777'}],
    ['ready',{}],
  ]) {
    child = spawn(process.execPath,['.next/standalone/server.js'],{env:{...env,...overrides,HOSTNAME:'127.0.0.1',PORT:'8788'},stdio:['ignore','pipe','pipe']});
    child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
    let ready=false;for(let i=0;i<120;i++){if(child.exitCode!==null)throw new Error(logs);try{if((await fetch(env.TEST_URL+'/api/auth')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,300));}assert.ok(ready);
    const current=await fetch(env.TEST_URL+'/api/auth',{headers:{Cookie:'sumatoni_session='+token}}).then(r=>r.json());assert.equal(current.entra,status);
    if(Object.keys(overrides).length) {
      assert.equal(current.me,null,'Microsoft session fails closed after disablement, incomplete configuration or tenant change');
      if(status!=='ready'){const start=await fetch(env.TEST_URL+'/api/auth/entra/start',{redirect:'manual'});assert.equal(start.headers.get('location'),'/login?entra_error=unavailable');}
    }else assert.equal(current.me.id,alice,'Original Microsoft session remains available in its configured tenant');
    const login=await fetch(env.TEST_URL+'/api/auth',{method:'POST',headers:{Origin:env.TEST_URL,'Content-Type':'application/json'},body:JSON.stringify({action:'login',login:'admin@entra.test',password:'Entra-admin-password-2026'})});assert.equal(login.status,200,'Local rescue account works in all configurations');
    const stopped=new Promise(r=>child.once('exit',r));child.kill();await stopped;
  }
  assert.equal(mock.calls.length,providerCalls,'Configuration failures and local fallback do not contact Microsoft');
  console.log('Disablement, incomplete configuration, tenant change and local rescue verified across four server restarts.');
} catch (e) { console.error(e); process.exitCode = 1; }
finally { child.kill(); mock.server.closeAllConnections(); mock.server.close(); }
