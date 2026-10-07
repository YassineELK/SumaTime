import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
process.env.DATABASE_PATH = resolve(mkdtempSync('/dev/shm/sumatime-roles-'), 'qa.sqlite');
const { sqlite } = await import('../db/raw.ts');
const { changeMemberRole } = await import('../lib/member-roles.ts');
const db = sqlite();
beforeEach(() => {
  db.exec('DROP TRIGGER IF EXISTS fail_role_audit');
  for (const table of ['member_role_events','sessions','entra_identities','accounts','entries','clients','members']) db.exec(`DELETE FROM ${table}`);
  for (const [id,role,active] of [['owner','admin',1],['other','admin',1],['alice','partner',1],['disabled','partner',0]]) {
    db.prepare('INSERT INTO members(id,email,name,role,active,created_at) VALUES (?,?,?,?,?,?)').run(id,id+'@example.test',id,role,active,'2026-01-01');
  }
  for (const id of ['owner','alice']) db.prepare("INSERT INTO accounts VALUES (?,?,'local','hash-kept',0)").run(id,id+'@example.test');
  db.exec("INSERT INTO clients(id,name,active) VALUES ('client','Client',1); INSERT INTO entries(id,member_id,client_id,ticket,date,start,end,created_at,updated_at) VALUES ('entry','alice','client','Historical','2026-01-02',540,600,'2026-01-02','2026-01-02');");
  db.prepare('INSERT INTO entra_identities VALUES (?,?,?,?,?)').run('alice','tenant','object','owner','now');
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run('local-session','alice',9999999999999);
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run('microsoft-session','alice',9999999999999);
  db.prepare('INSERT INTO entra_sessions VALUES (?,?,?)').run('microsoft-session','tenant','object');
});
const snapshot = table => db.prepare(`SELECT * FROM ${table}`).all();
const status = expected => error => error.status === expected;
test('promotion preserves business identity, credentials and Microsoft mapping; audits and revokes both session types', () => {
  const before=Object.fromEntries(['accounts','entries','clients','entra_identities'].map(t=>[t,snapshot(t)]));
  assert.equal(changeMemberRole('owner','alice','admin','partner'),true);
  assert.equal(db.prepare("SELECT role FROM members WHERE id='alice'").get().role,'admin');
  for (const [table,rows] of Object.entries(before)) assert.deepEqual(snapshot(table),rows);
  assert.equal(snapshot('sessions').length,0);assert.equal(snapshot('entra_sessions').length,0);
  const event=snapshot('member_role_events')[0];assert.equal(event.member_id,'alice');assert.equal(event.actor_id,'owner');assert.equal(event.previous_role,'partner');assert.equal(event.new_role,'admin');assert.ok(Date.parse(event.created_at));
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('demotion preserves entries and immediately removes old sessions',()=>{
  changeMemberRole('owner','alice','admin','partner');db.prepare('INSERT INTO sessions VALUES (?,?,?)').run('new-admin-session','alice',9999999999999);
  assert.equal(changeMemberRole('owner','alice','partner','admin'),true);assert.equal(snapshot('sessions').length,0);assert.equal(snapshot('entries').length,1);assert.equal(snapshot('member_role_events').length,2);
});
test('partner and inactive administrators cannot change roles',()=>{
  assert.throws(()=>changeMemberRole('alice','other','partner','admin'),status(403));
  db.exec("UPDATE members SET active=0 WHERE id='other'");assert.throws(()=>changeMemberRole('other','alice','admin','partner'),status(403));assert.equal(snapshot('member_role_events').length,0);
});
test('an actor demoted after authentication is rechecked transactionally',()=>{
  db.exec("UPDATE members SET role='partner' WHERE id='other'");assert.throws(()=>changeMemberRole('other','alice','admin','partner'),status(403));
});
test('self role modification is refused',()=>assert.throws(()=>changeMemberRole('owner','owner','partner','admin'),status(403)));
test('invalid roles, missing expected role, and unknown member are refused',()=>{
  for(const role of ['superadmin',{},null,1])assert.throws(()=>changeMemberRole('owner','alice',role,'partner'),status(400));
  assert.throws(()=>changeMemberRole('owner','alice','admin',undefined),status(400));assert.throws(()=>changeMemberRole('owner','missing','admin','partner'),status(404));
});
test('stale UI cannot overwrite a concurrent role change',()=>{
  changeMemberRole('owner','alice','admin','partner');assert.throws(()=>changeMemberRole('owner','alice','admin','partner'),status(409));assert.equal(snapshot('member_role_events').length,1);
});
test('unchanged role is a no-op, without audit or session revocation',()=>{
  assert.equal(changeMemberRole('owner','alice','partner','partner'),false);assert.equal(snapshot('sessions').length,2);assert.equal(snapshot('member_role_events').length,0);
});
test('disabled member must be reactivated before promotion',()=>assert.throws(()=>changeMemberRole('owner','disabled','admin','partner'),status(409)));
test('last active local administrator is protected even if another Microsoft admin exists',()=>{
  assert.throws(()=>changeMemberRole('other','owner','partner','admin'),status(409));assert.equal(db.prepare("SELECT role FROM members WHERE id='owner'").get().role,'admin');
});
test('local administrator may be demoted when a second active local administrator exists',()=>{
  db.prepare("INSERT INTO accounts VALUES ('other','other@example.test','local','hash',0)").run();assert.equal(changeMemberRole('other','owner','partner','admin'),true);
});
test('audit failure rolls back the role and every session deletion',()=>{
  db.exec("CREATE TRIGGER fail_role_audit BEFORE INSERT ON member_role_events BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.throws(()=>changeMemberRole('owner','alice','admin','partner'));assert.equal(db.prepare("SELECT role FROM members WHERE id='alice'").get().role,'partner');assert.equal(snapshot('sessions').length,2);
});
test('additive audit migration is repeatable without modifying prior data',()=>{
  const before=Object.fromEntries(['members','accounts','sessions','entries','clients','entra_identities'].map(t=>[t,snapshot(t)]));
  for(let n=0;n<2;n++)db.exec(readFileSync('drizzle/0010_member_role_events.sql','utf8'));
  for(const [t,rows]of Object.entries(before))assert.deepEqual(snapshot(t),rows);
});
