ALTER TABLE clients ADD COLUMN hourly_rate_cents INTEGER CHECK (hourly_rate_cents >= 0);
ALTER TABLE clients ADD COLUMN onsite_hourly_rate_cents INTEGER CHECK (onsite_hourly_rate_cents >= 0);
ALTER TABLE members ADD COLUMN travel_fee_cents INTEGER CHECK (travel_fee_cents >= 0);
ALTER TABLE entries ADD COLUMN hourly_rate_cents INTEGER CHECK (hourly_rate_cents >= 0);
CREATE TABLE travel_days (
  member_id TEXT NOT NULL REFERENCES members(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  date TEXT NOT NULL,
  fee_cents INTEGER CHECK (fee_cents >= 0),
  PRIMARY KEY (member_id, client_id, date)
);
