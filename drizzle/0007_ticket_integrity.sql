ALTER TABLE entries ADD COLUMN ticket_source TEXT NOT NULL DEFAULT 'legacy'
  CHECK(ticket_source IN ('glpi','pending','legacy'));
ALTER TABLE entries ADD COLUMN glpi_ticket_id INTEGER
  CHECK(glpi_ticket_id IS NULL OR glpi_ticket_id > 0);
ALTER TABLE work_timers ADD COLUMN ticket_source TEXT NOT NULL DEFAULT 'legacy'
  CHECK(ticket_source IN ('glpi','pending','legacy'));
ALTER TABLE work_timers ADD COLUMN glpi_ticket_id INTEGER
  CHECK(glpi_ticket_id IS NULL OR glpi_ticket_id > 0);

UPDATE entries SET ticket_source='legacy',glpi_ticket_id=NULL;
UPDATE work_timers SET ticket_source='legacy',glpi_ticket_id=NULL;

CREATE TRIGGER entries_ticket_identity_insert BEFORE INSERT ON entries
WHEN NOT ((NEW.ticket_source='glpi' AND NEW.glpi_ticket_id IS NOT NULL AND NEW.glpi_ticket_id>0)
  OR (NEW.ticket_source IN ('pending','legacy') AND NEW.glpi_ticket_id IS NULL))
BEGIN SELECT RAISE(ABORT,'invalid entry ticket identity'); END;
CREATE TRIGGER entries_ticket_identity_update BEFORE UPDATE OF ticket_source,glpi_ticket_id ON entries
WHEN NOT ((NEW.ticket_source='glpi' AND NEW.glpi_ticket_id IS NOT NULL AND NEW.glpi_ticket_id>0)
  OR (NEW.ticket_source IN ('pending','legacy') AND NEW.glpi_ticket_id IS NULL))
BEGIN SELECT RAISE(ABORT,'invalid entry ticket identity'); END;
CREATE TRIGGER work_timers_ticket_identity_insert BEFORE INSERT ON work_timers
WHEN NOT ((NEW.ticket_source='glpi' AND NEW.glpi_ticket_id IS NOT NULL AND NEW.glpi_ticket_id>0)
  OR (NEW.ticket_source IN ('pending','legacy') AND NEW.glpi_ticket_id IS NULL))
BEGIN SELECT RAISE(ABORT,'invalid timer ticket identity'); END;
CREATE TRIGGER work_timers_ticket_identity_update BEFORE UPDATE OF ticket_source,glpi_ticket_id ON work_timers
WHEN NOT ((NEW.ticket_source='glpi' AND NEW.glpi_ticket_id IS NOT NULL AND NEW.glpi_ticket_id>0)
  OR (NEW.ticket_source IN ('pending','legacy') AND NEW.glpi_ticket_id IS NULL))
BEGIN SELECT RAISE(ABORT,'invalid timer ticket identity'); END;
