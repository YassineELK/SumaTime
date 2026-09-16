// Copy an existing SQLite/D1 preview database without modifying its source.
import { DatabaseSync, backup } from 'node:sqlite';
import { resolve, dirname } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
const source = process.argv[2], target = resolve(process.env.DATABASE_PATH || 'data/timesheet.sqlite');
if (!source) throw new Error('Usage: node scripts/migrate-local.mjs <existing.sqlite>');
if (existsSync(target)) throw new Error('Destination exists. Refusing to overwrite business data.');
mkdirSync(dirname(target), { recursive: true });
const db = new DatabaseSync(resolve(source), { readOnly: true });
const counts = {};
for (const table of ['members', 'clients', 'entries']) counts[table] = db.prepare(`SELECT count(*) n FROM ${table}`).get().n;
await backup(db, target);
db.close();
const copy = new DatabaseSync(target, { readOnly: true });
for (const table of ['members', 'clients', 'entries']) {
  if (copy.prepare(`SELECT count(*) n FROM ${table}`).get().n !== counts[table]) throw new Error('Copy verification failed');
}
if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('Integrity check failed');
copy.close();
console.log('Migration verified. Original database retained.', counts);
