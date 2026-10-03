import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const globalDb = globalThis as unknown as { timeDatabase?: DatabaseSync };
export const dataPath = () => resolve(process.env.DATABASE_PATH || 'data/timesheet.sqlite');
export function sqlite() {
  if (globalDb.timeDatabase) return globalDb.timeDatabase;
  const file = dataPath();
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  if (!db.prepare("SELECT name FROM sqlite_master WHERE name='members'").get()) {
    db.exec(readFileSync(resolve('drizzle/0000_spotty_luminals.sql'), 'utf8'));
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const columns = db.prepare('PRAGMA table_info(entries)').all() as { name: string }[];
    if (!columns.some(column => column.name === 'on_site')) db.exec(readFileSync(resolve('drizzle/0001_entry_location.sql'), 'utf8'));
    if (!columns.some(column => column.name === 'hourly_rate_cents')) db.exec(readFileSync(resolve('drizzle/0002_billing_rates.sql'), 'utf8'));
    const travelColumns = db.prepare('PRAGMA table_info(travel_days)').all() as { name: string }[];
    if (!travelColumns.some(column => column.name === 'anchor_entry_id')) db.exec(readFileSync(resolve('drizzle/0003_travel_anchor.sql'), 'utf8'));
    const clientColumns = db.prepare('PRAGMA table_info(clients)').all() as { name: string }[];
    if (!clientColumns.some(column => column.name === 'color')) db.exec(readFileSync(resolve('drizzle/0004_client_color.sql'), 'utf8'));
    if (!clientColumns.some(column => column.name === 'glpi_entity_id')) db.exec(readFileSync(resolve('drizzle/0005_provider_workspace.sql'), 'utf8'));
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  db.exec(`CREATE TABLE IF NOT EXISTS accounts (
    member_id TEXT PRIMARY KEY REFERENCES members(id), login TEXT NOT NULL UNIQUE,
    provider TEXT NOT NULL CHECK(provider IN ('local','ldap')), password_hash TEXT,
    must_change INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_member ON sessions(member_id);
    CREATE TABLE IF NOT EXISTS login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, until INTEGER NOT NULL);`);
  db.exec(`CREATE TABLE IF NOT EXISTS glpi_creations (
    request_id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id), api_url TEXT NOT NULL,
    payload_hash TEXT NOT NULL, result_json TEXT, created_at TEXT NOT NULL);`);
  globalDb.timeDatabase = db;
  const tokenFile = resolve(dirname(file), 'setup-token.txt');
  if (!process.env.SETUP_TOKEN && !existsSync(tokenFile) && !(db.prepare('SELECT 1 FROM accounts LIMIT 1').get())) {
    writeFileSync(tokenFile, randomBytes(24).toString('hex'), { mode: 0o600, flag: 'wx' });
  }
  return db;
}
export function setupToken() {
  sqlite();
  return process.env.SETUP_TOKEN || readFileSync(resolve(dirname(dataPath()), 'setup-token.txt'), 'utf8').trim();
}
export function transaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = sqlite(); db.exec('BEGIN IMMEDIATE');
  try { const result = fn(db); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
class Statement {
  constructor(private sql: string, private values: SQLInputValue[] = []) {}
  bind(...values: SQLInputValue[]) { return new Statement(this.sql, values); }
  async first<T = Record<string, unknown>>(): Promise<T | null> { return (sqlite().prepare(this.sql).get(...this.values) as T) || null; }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> { return { results: sqlite().prepare(this.sql).all(...this.values) as T[] }; }
  async run() { const result = sqlite().prepare(this.sql).run(...this.values); return { meta: { changes: Number(result.changes) } }; }
}
export function database() { return { prepare: (sql: string) => new Statement(sql) }; }
