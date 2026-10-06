import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
const runtimeRoot = process.env.QA_RUNTIME_ROOT || '.sites-runtime';
mkdirSync(runtimeRoot, { recursive: true });
const directory = mkdtempSync(resolve(runtimeRoot, 'accounts-qa-'));
const env = { ...process.env, DATABASE_PATH: resolve(directory, 'qa.sqlite'), SETUP_TOKEN: randomBytes(32).toString('hex'), APP_URL: 'http://127.0.0.1:8787', TEST_URL: 'http://127.0.0.1:8787', ENTRA_ENABLED: 'false', LDAP_ENABLED: 'false', NEXT_TELEMETRY_DISABLED: '1' };
const serverArgs = existsSync('.next/standalone/server.js') ? ['.next/standalone/server.js'] : ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '8787'];
const child = spawn(process.execPath, serverArgs, { env: { ...env, HOSTNAME: '127.0.0.1', PORT: '8787' }, stdio: ['ignore','pipe','pipe'] });
let logs = '';
child.stdout.on('data', chunk => { logs += chunk; }); child.stderr.on('data', chunk => { logs += chunk; });
try {
  let ready = false;
  for (let i = 0; i < 400; i++) {
    if (child.exitCode !== null) throw new Error(logs);
    try { const result = await fetch(env.TEST_URL + '/api/auth'); if (result.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  if (!ready) throw new Error('QA server not ready: ' + logs);
  const test = spawn(process.execPath, ['--import=tsx', 'tests/api-recette.mjs'], { env, stdio: 'inherit' });
  const code = await new Promise(resolve => test.on('exit', resolve));
  if (code !== 0) { console.error(logs); process.exitCode = 1; }
} finally { child.kill(); }
