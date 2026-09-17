import { DatabaseSync, backup } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync, chmodSync, constants } from 'node:fs';
import { resolve, join, dirname } from 'node:path';

process.umask(0o077);
const source = resolve(process.env.DATABASE_PATH || '/var/lib/sumatoni-time/timesheet.sqlite');
const directory = resolve(process.env.BACKUP_DIRECTORY || '/var/backups/sumatoni-time', new Date().toISOString().replaceAll(':', '-'));
if (!existsSync(source)) throw new Error('Database does not exist; refusing an empty backup.');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const target = join(directory, 'timesheet.sqlite');
if (existsSync(target)) throw new Error('Backup already exists.');
const db = new DatabaseSync(source, { readOnly: true });
await backup(db, target); db.close(); chmodSync(target, 0o600);
const check = new DatabaseSync(target, { readOnly: true });
if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Database integrity check failed.');
const tables = ['members', 'accounts', 'clients', 'entries', 'travel_days', 'work_timers', 'glpi_credentials'];
const counts = Object.fromEntries(tables.map(table => [table, check.prepare(`SELECT count(*) AS n FROM ${table}`).get().n]));
check.close();
const files = ['timesheet.sqlite'];
const key = join(dirname(source), 'glpi-key');
if (existsSync(key)) { copyFileSync(key, join(directory, 'glpi-key'), constants.COPYFILE_EXCL); chmodSync(join(directory, 'glpi-key'), 0o600); files.push('glpi-key'); }
if (counts.glpi_credentials > 0 && !existsSync(key)) throw new Error('GLPI credentials exist without their encryption key. Backup cannot be marked complete.');
const configuration = process.env.BACKUP_CONFIG_PATH || '/etc/sumatoni-time/sumatoni.env';
if (existsSync(configuration)) { copyFileSync(configuration, join(directory, 'sumatoni.env'), constants.COPYFILE_EXCL); chmodSync(join(directory, 'sumatoni.env'), 0o600); files.push('sumatoni.env'); }
const sha256 = Object.fromEntries(files.map(file => [file, createHash('sha256').update(readFileSync(join(directory, file))).digest('hex')]));
writeFileSync(join(directory, 'manifest.json'), JSON.stringify({ completed: true, createdAt: new Date().toISOString(), counts, sha256 }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
console.log('Verified backup:', directory);
