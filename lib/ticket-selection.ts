export const PENDING_TICKET_LABEL = 'À compléter';
export type TicketSource = 'glpi' | 'pending' | 'legacy';
export type TicketSelection = { ticket: string; ticket_source?: TicketSource; glpi_ticket_id?: number | null };

export function validGlpiTicketId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export function normalizedTicketQuery(value: string) {
  const trimmed = value.trim();
  const prefixed = /^glpi\s*-?\s*(\d+)$/i.exec(trimmed);
  return prefixed ? prefixed[1] : trimmed;
}

export function ticketSelectionReady(value: TicketSelection) {
  return value.ticket_source === 'pending'
    ? value.glpi_ticket_id == null && value.ticket === PENDING_TICKET_LABEL
    : value.ticket_source === 'glpi' && validGlpiTicketId(value.glpi_ticket_id) && value.ticket === `GLPI-${value.glpi_ticket_id}`;
}

export function ticketBadge(source: TicketSource) {
  return source === 'glpi' ? 'Ticket GLPI vérifié' : source === 'pending' ? PENDING_TICKET_LABEL : 'Référence historique';
}
