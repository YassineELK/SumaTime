// Server-side recovery only. Receives JSON on stdin, never a password argument.
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { hashPassword, validPassword } from '../lib/password.ts';
if (process.stdin.isTTY) throw new Error('Use reset-local-password.ps1 for a hidden password prompt.');
let raw = '';
for await (const chunk of process.stdin) { raw += chunk; if (raw.length > 4096) throw new Error('Input too long'); }
const { email, password } = JSON.parse(raw.replace(/^\uFEFF/, ''));
if (!validPassword(password)) throw new Error('Le mot de passe doit contenir entre 12 et 128 caractères.');
const db = new DatabaseSync(resolve(process.env.DATABASE_PATH || 'data/timesheet.sqlite'), { open: true });
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
const account = db.prepare("SELECT a.member_id FROM accounts a JOIN members m ON m.id=a.member_id WHERE m.email=? AND a.provider='local'").get(String(email).trim().toLowerCase());
if (!account) throw new Error('Compte local introuvable.');
const hash = await hashPassword(password);
db.exec('BEGIN IMMEDIATE');
try {
  db.prepare('UPDATE accounts SET password_hash=?,must_change=1 WHERE member_id=?').run(hash, account.member_id);
  db.prepare('DELETE FROM sessions WHERE member_id=?').run(account.member_id);
  db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; }
db.close(); console.log('Mot de passe provisoire défini. Les sessions précédentes sont révoquées.');
