ALTER TABLE travel_days ADD COLUMN anchor_entry_id TEXT;
UPDATE travel_days SET anchor_entry_id = (
  SELECT e.id FROM entries e
  WHERE e.member_id=travel_days.member_id AND e.client_id=travel_days.client_id
    AND e.date=travel_days.date AND e.on_site=1
  ORDER BY e.created_at,e.id LIMIT 1
);
