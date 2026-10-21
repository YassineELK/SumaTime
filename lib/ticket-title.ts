import type { Entry } from './types';
type Ticket = Pick<Entry, 'ticket' | 'ticket_source' | 'glpi_ticket_id' | 'ticket_title'>;
export function ticketTitleLabel(entry: Pick<Ticket, 'ticket_source' | 'ticket_title'>) {
  return entry.ticket_title?.trim() || (entry.ticket_source === 'pending' ? 'À compléter' : 'Intitulé non disponible');
}
export function historicalTicketId(entry: Ticket): number | null {
  if (entry.ticket_source === 'glpi' && Number.isSafeInteger(entry.glpi_ticket_id) && Number(entry.glpi_ticket_id) > 0) return entry.glpi_ticket_id;
  // An exact historical GLPI reference is recoverable; arbitrary legacy text is not guessed.
  const match = entry.ticket_source === 'legacy' ? /^GLPI-([1-9]\d*)$/.exec(entry.ticket) : null;
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
