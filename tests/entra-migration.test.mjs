import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
const directory=mkdtempSync('/dev/shm/sumatime-entra-migration-');process.env.DATABASE_PATH=resolve(directory,'qa.sqlite');
const old=new DatabaseSync(process.env.DATABASE_PATH);
for(const migration of ['0000_spotty_luminals.sql','0001_entry_location.sql','0002_billing_rates.sql','0003_travel_anchor.sql','0004_client_color.sql','0005_provider_workspace.sql','0007_ticket_integrity.sql'])old.exec(readFileSync(resolve('drizzle',migration),'utf8'));
old.exec(`CREATE TABLE accounts(member_id TEXT PRIMARY KEY REFERENCES members(id),login TEXT NOT NULL UNIQUE,provider TEXT NOT NULL CHECK(provider IN ('local','ldap')),password_hash TEXT,must_change INTEGER NOT NULL DEFAULT 0);
CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,member_id TEXT NOT NULL REFERENCES members(id),expires INTEGER NOT NULL);
INSERT INTO members(id,email,name,role,active,created_at) VALUES ('owner','owner@example.test','Owner','admin',1,'2026-01-01');
INSERT INTO accounts VALUES ('owner','owner@example.test','local','hash-preserved',0);
INSERT INTO sessions VALUES ('existing-session','owner',9999999999999);
INSERT INTO clients(id,name,active) VALUES ('client','Client',1);
INSERT INTO entries(id,member_id,client_id,ticket,date,start,end,created_at,updated_at) VALUES ('entry','owner','client','Historical','2026-01-02',540,600,'2026-01-02','2026-01-02');`);
const baseline={};for(const table of ['members','accounts','sessions','clients','entries'])baseline[table]=old.prepare(`SELECT * FROM ${table}`).all();old.close();
const {sqlite}=await import('../db/raw.ts');const db=sqlite();
test('Entra migration is additive and preserves existing identities, sessions and billing data',()=>{
 for(const [table,rows]of Object.entries(baseline))assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(),rows,table);
 db.exec(readFileSync(resolve('drizzle/0008_entra_auth.sql'),'utf8'));db.exec(readFileSync(resolve('drizzle/0009_entra_provision.sql'),'utf8'));db.exec(readFileSync(resolve('drizzle/0009_entra_provision.sql'),'utf8'));assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('identity uniqueness and persistent session markers prevent revoked Microsoft sessions falling back to local login',()=>{
 db.prepare('INSERT INTO entra_identities VALUES (?,?,?,?,?)').run('owner','tenant','object','owner','now');
 assert.throws(()=>db.prepare('INSERT INTO entra_identities VALUES (?,?,?,?,?)').run('owner','tenant','other','owner','now'));
 db.prepare('INSERT INTO entra_sessions VALUES (?,?,?)').run('existing-session','tenant','object');db.prepare('DELETE FROM entra_identities WHERE member_id=?').run('owner');
 assert.ok(db.prepare('SELECT 1 FROM entra_sessions WHERE token_hash=?').get('existing-session'),'deleting a mapping keeps its Microsoft marker');
 db.prepare('DELETE FROM sessions WHERE token_hash=?').run('existing-session');assert.equal(db.prepare('SELECT COUNT(*) AS n FROM entra_sessions').get().n,0,'deleting the session cascades its marker');
});
