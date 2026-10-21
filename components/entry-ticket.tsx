import type { Entry } from '@/lib/types';
import { ticketBadge } from '@/lib/ticket-selection';
import { ticketTitleLabel } from '@/lib/ticket-title';
export default function EntryTicket({ entry }: { entry: Pick<Entry, 'ticket' | 'ticket_source' | 'ticket_title'> }) {
  return <><span className="ticket">{entry.ticket} <span className={`ticket-source ${entry.ticket_source}`}>{ticketBadge(entry.ticket_source)}</span></span>
    {entry.ticket_source !== 'pending' && <span className="ticket-title">{ticketTitleLabel(entry)}</span>}</>;
}
