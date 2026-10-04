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
    payload_hash TEXT NOT NULL, payload_json TEXT, result_json TEXT, acknowledged_at TEXT,
    expires_at TEXT, legacy_state TEXT, created_at TEXT NOT NULL);`);
  // The alias table is the durable bridge between browser-generated UUIDs and
  // the one server-authoritative operation reserved by the canonical payload.
  // It intentionally keeps the result snapshot as well as the operation FK:
  // a response lost after ACK can still be reconciled without another GLPI
  // POST, while the FK lets the normal operation row remain authoritative.
  db.exec(`CREATE TABLE IF NOT EXISTS glpi_creation_aliases (
    alias_request_id TEXT PRIMARY KEY,
    operation_request_id TEXT NOT NULL REFERENCES glpi_creations(request_id) ON DELETE CASCADE,
    member_id TEXT NOT NULL REFERENCES members(id), api_url TEXT NOT NULL,
    payload_hash TEXT NOT NULL, result_json TEXT, created_at TEXT NOT NULL, expires_at TEXT);
    CREATE INDEX IF NOT EXISTS glpi_creation_aliases_operation
      ON glpi_creation_aliases(operation_request_id);
    CREATE INDEX IF NOT EXISTS glpi_creation_aliases_fingerprint
      ON glpi_creation_aliases(member_id,api_url,payload_hash);`);
  // glpi_creations is deliberately migrated here as well as being created
  // above: installations from the first v0.3 builds predate the payload and
  // acknowledgement columns.  A legacy row without a payload or confirmed
  // result is *not* safe to acknowledge automatically: it remains an explicit
  // member-scoped blocker until the user verifies GLPI and abandons it or
  // supplies proof that lets us recover it.
  const creationColumns = db.prepare('PRAGMA table_info(glpi_creations)').all() as { name: string }[];
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!creationColumns.some(column => column.name === 'payload_json')) {
      db.exec('ALTER TABLE glpi_creations ADD COLUMN payload_json TEXT');
    }
    if (!creationColumns.some(column => column.name === 'acknowledged_at')) {
      db.exec('ALTER TABLE glpi_creations ADD COLUMN acknowledged_at TEXT');
    }
    if (!creationColumns.some(column => column.name === 'expires_at')) {
      db.exec('ALTER TABLE glpi_creations ADD COLUMN expires_at TEXT');
    }
    if (!creationColumns.some(column => column.name === 'legacy_state')) {
      db.exec('ALTER TABLE glpi_creations ADD COLUMN legacy_state TEXT');
    }
    // Rows from the old schema that have no payload and no result represent an
    // unresolved provider attempt.  Clear any acknowledgement a previous
    // buggy migration may have written, and keep them blocking forever until a
    // deliberate resolution action changes their state.
    db.exec(`UPDATE glpi_creations SET legacy_state=CASE
      WHEN payload_json IS NULL AND result_json IS NULL THEN 'pending'
      WHEN payload_json IS NULL AND result_json IS NOT NULL THEN 'completed'
      WHEN legacy_state IS NULL THEN 'active'
      ELSE legacy_state END
      WHERE legacy_state IS NULL OR legacy_state=''`);
    db.exec(`UPDATE glpi_creations
      SET legacy_state='pending', acknowledged_at=NULL, expires_at=NULL
      WHERE payload_json IS NULL AND result_json IS NULL AND COALESCE(legacy_state,'pending')<>'abandoned'`);
    // A result-only legacy row is safe to hide from the uncertainty queue: it
    // has a provider proof even though its old payload cannot be reconstructed.
    // Keep that audit proof; cleanup intentionally only removes payload-bearing
    // rows whose result can still be replayed by a canonical request.
    db.exec(`UPDATE glpi_creations
      SET legacy_state='completed', acknowledged_at=COALESCE(acknowledged_at,created_at)
      WHERE payload_json IS NULL AND result_json IS NOT NULL AND COALESCE(legacy_state,'completed')<>'abandoned'`);
    db.exec(`UPDATE glpi_creations
      SET expires_at=COALESCE(expires_at,datetime(COALESCE(acknowledged_at,created_at), '+30 days'))
      WHERE acknowledged_at IS NOT NULL AND result_json IS NOT NULL`);

    // Every payload-bearing operation, including an already acknowledged one,
    // gets a self-alias.  This backfills the relation for databases upgraded
    // from the first fingerprint-only reservation implementation.
    db.exec(`INSERT OR IGNORE INTO glpi_creation_aliases
      (alias_request_id,operation_request_id,member_id,api_url,payload_hash,result_json,created_at,expires_at)
      SELECT request_id,request_id,member_id,api_url,payload_hash,result_json,created_at,expires_at
      FROM glpi_creations WHERE payload_json IS NOT NULL`);

    // Older builds had no fingerprint uniqueness.  Keep the oldest
    // authoritative row for each still-live operation and make any duplicate
    // rows legacy-safe before installing the database-enforced reservation.
    const duplicates = db.prepare(`SELECT member_id,api_url,payload_hash
      FROM glpi_creations
      WHERE payload_json IS NOT NULL AND acknowledged_at IS NULL
      GROUP BY member_id,api_url,payload_hash HAVING COUNT(*) > 1`).all() as { member_id: string; api_url: string; payload_hash: string }[];
    for (const duplicate of duplicates) {
      const rows = db.prepare(`SELECT request_id,result_json,created_at
        FROM glpi_creations
        WHERE member_id=? AND api_url=? AND payload_hash=? AND payload_json IS NOT NULL AND acknowledged_at IS NULL
        ORDER BY CASE WHEN result_json IS NULL THEN 1 ELSE 0 END,created_at,request_id`).all(duplicate.member_id, duplicate.api_url, duplicate.payload_hash) as { request_id: string; result_json: string | null; created_at: string }[];
      const winner = rows[0];
      if (!winner) continue;
      for (const loser of rows.slice(1)) {
        if (!winner.result_json && loser.result_json) {
          db.prepare('UPDATE glpi_creations SET result_json=? WHERE request_id=?').run(loser.result_json, winner.request_id);
          winner.result_json = loser.result_json;
        }
        db.prepare(`UPDATE glpi_creation_aliases
          SET operation_request_id=?, result_json=?, expires_at=(SELECT expires_at FROM glpi_creations WHERE request_id=?)
          WHERE alias_request_id=?`).run(winner.request_id, winner.result_json, winner.request_id, loser.request_id);
        db.prepare(`UPDATE glpi_creations SET acknowledged_at=COALESCE(acknowledged_at,created_at),
          expires_at=CASE WHEN result_json IS NOT NULL THEN COALESCE(expires_at,datetime(COALESCE(acknowledged_at,created_at), '+30 days')) ELSE NULL END
          WHERE request_id=?`).run(loser.request_id);
      }
    }
    // Keep alias snapshots synchronized with any result transferred while
    // normalizing old duplicate rows.
    db.exec(`UPDATE glpi_creation_aliases
      SET result_json=(SELECT result_json FROM glpi_creations WHERE request_id=operation_request_id),
          expires_at=(SELECT expires_at FROM glpi_creations WHERE request_id=operation_request_id)`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS glpi_creations_live_fingerprint_unique
      ON glpi_creations(member_id,api_url,payload_hash)
      WHERE acknowledged_at IS NULL AND payload_json IS NOT NULL`);
    // Cleanup is intentionally fail-closed: only acknowledged rows with a
    // validated result and an explicit expiry are eligible.  Uncertain and
    // result-less legacy rows are never silently purged.
    db.prepare(`DELETE FROM glpi_creations
      WHERE payload_json IS NOT NULL AND acknowledged_at IS NOT NULL AND result_json IS NOT NULL
        AND expires_at IS NOT NULL AND expires_at<=?`).run(new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
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
