import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Source-only package: never include database files, credentials, backups or logs.
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(file =>
  existsSync(file) && !/^(data|backups|outputs|work|node_modules|\.git|\.next|\.wrangler|\.sites-runtime|\.agents|\.codex)\//.test(file)
  && (!file.startsWith('.env') || file === '.env.example'));
if (files.includes('.npmrc') && /(_auth|password|token)\s*=/i.test(readFileSync('.npmrc', 'utf8'))) throw new Error('Private npm configuration cannot be packaged');
mkdirSync('.sites-runtime', { recursive: true }); mkdirSync('outputs', { recursive: true });
const list = resolve('.sites-runtime/windows-package-files.txt');
writeFileSync(list, [...new Set(files)].join('\n'));
const archive = resolve('outputs/Sumatoni-Time-Windows.zip');
execFileSync('tar', ['-a', '-cf', archive, '-T', list]);
const entries = execFileSync('tar', ['-tf', archive], { encoding: 'utf8' });
if (/(^|\n)(data\/|backups\/|\.env\.local)/.test(entries)) throw new Error('Unexpected private file in package');
console.log('Windows source package verified:', archive);
