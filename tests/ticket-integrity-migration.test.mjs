import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = mkdtempSync('/dev/shm/sumatime-ticket-integrity-');
process.env.DATABASE_PATH = resolve(directory, 'migration.sqlite');
const source = new DatabaseSync(process.env.DATABASE_PATH);
for (const migration of ['0000_spotty_luminals.sql', '0001_entry_location.sql', '0002_billing_rates.sql', '0003_travel_anchor.sql', '0004_client_color.sql', '0005_provider_workspace.sql']) source.exec(readFileSync(resolve('drizzle', migration), 'utf8'));
source.exec(`INSERT INTO members(id,email,name,created_at) VALUES ('member-old','old@example.test','Old member','2026-01-01T00:00:00.000Z');
  INSERT INTO clients(id,name,active) VALUES ('client-old','Old client',1);
  INSERT INTO entries(id,member_id,client_id,ticket,date,start,end,description,billed,on_site,version,created_at,updated_at)
    VALUES ('entry-old','member-old','client-old','GLPI-123','2026-01-02',540,600,'',0,0,1,'2026-01-02T00:00:00.000Z','2026-01-02T00:00:00.000Z');
  INSERT INTO work_timers(member_id,id,client_id,ticket,description,on_site,started_at)
    VALUES ('member-old','timer-old','client-old','GLPI-456','',0,1);`);
source.close();

const { sqlite } = await import('../db/raw.ts');
const db = sqlite();

test('ticket integrity migration marks all historical entries and active timers legacy without inferring GLPI IDs', () => {
  const entry = db.prepare('SELECT ticket,ticket_source,glpi_ticket_id FROM entries WHERE id=?').get('entry-old');
  const timer = db.prepare('SELECT ticket,ticket_source,glpi_ticket_id FROM work_timers WHERE id=?').get('timer-old');
  assert.deepEqual({ ...entry }, { ticket: 'GLPI-123', ticket_source: 'legacy', glpi_ticket_id: null });
  assert.deepEqual({ ...timer }, { ticket: 'GLPI-456', ticket_source: 'legacy', glpi_ticket_id: null });
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});

test('ticket integrity constraints reject invalid source/id values', () => {
  assert.throws(() => db.prepare("UPDATE entries SET ticket_source='invented' WHERE id='entry-old'").run());
  assert.throws(() => db.prepare("UPDATE entries SET glpi_ticket_id=0 WHERE id='entry-old'").run());
  assert.throws(() => db.prepare("UPDATE entries SET ticket_source='legacy',glpi_ticket_id=123 WHERE id='entry-old'").run());
  assert.throws(() => db.prepare("UPDATE entries SET ticket_source='glpi',glpi_ticket_id=NULL WHERE id='entry-old'").run());
  assert.throws(() => db.prepare("UPDATE work_timers SET glpi_ticket_id=-1 WHERE id='timer-old'").run());
});
