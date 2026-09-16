-- NULL retains the unknown mode of historical entries; new entries choose a mode.
ALTER TABLE entries ADD COLUMN on_site INTEGER CHECK (on_site IN (0, 1));
