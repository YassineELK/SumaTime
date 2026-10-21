import { billedMinutes, clockTime, locationLabel } from './business';
import type { Entry } from './types';
import { ticketTitleLabel } from './ticket-title';
// Explicit projection: provider identity, internal notes and all prices are excluded.
export function clientStatement(rows: Entry[]): unknown[][] {
  return [['Date', 'Début', 'Fin', 'Durée facturable (minutes)', 'Mode de prestation', 'N° de ticket', 'Intitulé du ticket'],
    ...[...rows].sort((a,b) => a.date.localeCompare(b.date) || a.start-b.start || a.end-b.end).map(e =>
      [e.date, clockTime(e.start), clockTime(e.end), billedMinutes(e.start,e.end), locationLabel(e.on_site), e.ticket, ticketTitleLabel(e)])];
}
