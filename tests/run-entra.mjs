import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { mkdirSync, mkdtempSync } from 'node:fs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mockMicrosoft, tenant, clientId, aliceOid } from './entra-mock.mjs';
const runtimeRoot = process.env.QA_RUNTIME_ROOT || '.sites-runtime';
mkdirSync(runtimeRoot, { recursive: true });
const directory = mkdtempSync(resolve(runtimeRoot, 'entra-qa-'));
const mock = await mockMicrosoft();
const env = { ...process.env, DATABASE_PATH: resolve(directory, 'qa.sqlite'), SETUP_TOKEN: randomBytes(32).toString('hex'),
  APP_URL: 'http://127.0.0.1:8788', TEST_URL: 'http://127.0.0.1:8788', LDAP_ENABLED: 'false',
  ENTRA_ENABLED: 'true', ENTRA_TENANT_ID: tenant, ENTRA_CLIENT_ID: clientId, ENTRA_CLIENT_SECRET: 'test-only-secret', ENTRA_SESSION_MINUTES: '60',
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
  assert.ok(!logs.includes('test-only-secret') && !logs.includes('never-store-this-token'), 'No credential/token in server logs');
  console.log('Microsoft simulator: PKCE, client authentication and JWKS verified; no provider tokens in logs.');
  const exited = new Promise(r => child.once('exit', r)); child.kill(); await exited;
  const db = new DatabaseSync(env.DATABASE_PATH), token = randomBytes(32).toString('hex');
  const alice = db.prepare('SELECT id FROM members WHERE email=?').get('alice@entra.test').id;
  const owner = db.prepare('SELECT id FROM members WHERE role=?').get('admin').id;
  const hash = createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT INTO entra_identities VALUES (?,?,?,?,?)').run(alice,tenant,aliceOid,owner,new Date().toISOString());
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
