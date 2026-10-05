'use client';

import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react';
import type { GlpiTicket } from '@/lib/glpi';
import type { Client } from '@/lib/types';
import { normalizedTicketQuery, PENDING_TICKET_LABEL, ticketBadge, type TicketSource } from '@/lib/ticket-selection';

export type TicketPickerValue = { ticket: string; ticket_source?: TicketSource; glpi_ticket_id?: number | null };
const statuses: Record<number, string> = { 1: 'Nouveau', 2: 'En cours', 3: 'Planifié', 4: 'En attente', 5: 'Résolu', 6: 'Clos' };

export default function TicketPicker({ value, clientId, clients, disabled = false, onChange }: { value: TicketPickerValue; clientId: string; clients: Client[]; disabled?: boolean; onChange: (value: TicketPickerValue & { client_id?: string }) => void }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const query = value.ticket;
  const [open, setOpen] = useState(false), [includeClosed, setIncludeClosed] = useState(false);
  const [tickets, setTickets] = useState<GlpiTicket[]>([]), [loading, setLoading] = useState(false), [error, setError] = useState(''), [active, setActive] = useState(-1);
  const sequence = useRef(0), previousClient = useRef(clientId);
  useEffect(() => {
    if (previousClient.current !== clientId && (value.ticket_source === 'glpi' || value.ticket_source === 'legacy')) onChange({ ticket: '', ticket_source: undefined, glpi_ticket_id: null });
    previousClient.current = clientId;
  }, [clientId, onChange, value.ticket_source]);
  useEffect(() => {
    if (!open || disabled) return;
    const call = ++sequence.current, controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true); setError('');
      const params = new URLSearchParams({ tickets: '1', q: normalizedTicketQuery(query), page: '0', open: String(!includeClosed) });
      void fetch('/api/glpi?' + params, { cache: 'no-store', signal: controller.signal }).then(async response => {
        const result = await response.json() as { tickets?: GlpiTicket[]; error?: string };
        if (!response.ok) throw new Error(result.error || 'Recherche GLPI indisponible.');
        if (call === sequence.current) { setTickets(result.tickets || []); setActive((result.tickets || []).length ? 0 : -1); }
      }).catch(reason => { if (!controller.signal.aborted && call === sequence.current) { setTickets([]); setActive(-1); setError(reason instanceof Error ? reason.message : 'Recherche GLPI indisponible.'); } })
        .finally(() => { if (call === sequence.current) setLoading(false); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [disabled, includeClosed, open, query]);
  function show() { setOpen(true); setLoading(true); }
  function type(text: string) { show(); setActive(-1); setError(''); onChange({ ticket: text, ticket_source: undefined, glpi_ticket_id: null }); }
  function choose(ticket: GlpiTicket) { if (!ticket.client_id || ticket.client_active !== 1) return; const display = `GLPI-${ticket.id}`; setOpen(false); onChange({ ticket: display, ticket_source: 'glpi', glpi_ticket_id: ticket.id, client_id: ticket.client_id }); }
  function pending() { setOpen(false); onChange({ ticket: PENDING_TICKET_LABEL, ticket_source: 'pending', glpi_ticket_id: null }); }
  function key(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setActive(-1); if (document.activeElement !== input.current) input.current?.focus(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); const step = event.key === 'ArrowDown' ? 1 : -1; setActive(current => tickets.length ? (current + step + tickets.length) % tickets.length : -1); }
    if (event.key === 'Enter' && open && active >= 0) { const option = tickets[active]; if (option?.client_id && option.client_active === 1) { event.preventDefault(); choose(option); } }
  }
  function leave(event: FocusEvent<HTMLDivElement>) { if (!root.current?.contains(event.relatedTarget as Node | null)) { setOpen(false); setActive(-1); } }
  const live = loading ? 'Recherche des tickets GLPI en cours.' : error ? `${error} Vous pouvez choisir « À compléter ».` : tickets.length ? `${tickets.length} suggestion${tickets.length > 1 ? 's' : ''} disponible${tickets.length > 1 ? 's' : ''}.` : 'Aucun ticket trouvé.';
  return <div className="ticket-picker" ref={root} onBlurCapture={leave}>
    <label htmlFor={id}>Ticket <span className="required">*</span></label>
    <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-listbox`} aria-describedby={`${id}-status`} aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined} autoComplete="off" maxLength={120} disabled={disabled} value={query} placeholder="Numéro ou titre du ticket GLPI…" onFocus={show} onChange={event => type(event.target.value)} onKeyDown={key} />
    <div className="ticket-picker-state"><span className={`ticket-source ${value.ticket_source || 'required'}`}>{value.ticket_source ? ticketBadge(value.ticket_source) : 'Sélection requise'}</span><button type="button" className="text-button" disabled={disabled} onClick={pending}>À compléter plus tard</button></div>
    <span id={`${id}-status`} className="sr-only" role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'} aria-atomic="true">{open ? live : ''}</span>
    {open && <div className="ticket-picker-popup"><div className="ticket-picker-toolbar"><span>{loading ? 'Recherche…' : 'Tickets accessibles'}</span><label><input type="checkbox" checked={includeClosed} title="Les tickets résolus sont déjà inclus. Cette option ajoute les tickets clos." onChange={event => { setLoading(true); setIncludeClosed(event.target.checked); }} /> Inclure les clos</label></div><p className={`ticket-picker-live${error ? ' error' : ''}`} aria-hidden="true">{live}</p><div id={`${id}-listbox`} role="listbox" aria-label="Suggestions de tickets GLPI" aria-busy={loading}>
      {tickets.map((ticket, index) => { const mapped = !!ticket.client_id && ticket.client_active === 1 && clients.some(client => client.id === ticket.client_id && client.active); return <button id={`${id}-option-${index}`} key={ticket.id} type="button" role="option" aria-selected={active === index} aria-disabled={!mapped} disabled={!mapped} className={active === index ? 'active' : ''} onMouseDown={event => event.preventDefault()} onClick={() => choose(ticket)}><strong>GLPI-{ticket.id} · {ticket.title}</strong><span>{statuses[ticket.status] || `Statut ${ticket.status}`} · {ticket.client || `Entité ${ticket.entity} non associée`}{ticket.client_active === 0 ? ' · client archivé' : ''}</span></button>; })}
    </div></div>}
  </div>;
}
