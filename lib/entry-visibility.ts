import type { Entry, Member } from './types';

// Fail closed: adding an internal DB column must not expose a new commercial term.
// Keep the null sale field for backwards-compatible clients, never its value.
export function visibleEntry(row: Entry & { color?: string | null }, role: Member['role']): Entry & { color?: string | null } {
  if (role === 'admin') return row;
  return {
    id: row.id, member_id: row.member_id, client_id: row.client_id,
    client: row.client, member: row.member, ticket: row.ticket,
    ticket_source: row.ticket_source, glpi_ticket_id: row.glpi_ticket_id,
    date: row.date, start: row.start, end: row.end, description: row.description,
    on_site: row.on_site, billed: row.billed, version: row.version,
    hourly_rate_cents: null, provider_rate_cents: row.provider_rate_cents ?? null,
    travel_counted: row.travel_counted ?? 0, travel_cents: row.travel_cents ?? null,
    ...(row.color !== undefined ? { color: row.color } : {}),
  };
}

export const providerRateColumn = `(SELECT pr.hourly_rate_cents FROM provider_rates pr
  WHERE pr.member_id=e.member_id AND pr.effective_from<=e.date
  ORDER BY pr.effective_from DESC LIMIT 1) AS provider_rate_cents`;
