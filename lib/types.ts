export type Member = { id: string; user_id: string | null; email: string; name: string; role: 'admin' | 'partner'; active: number; provider?: 'local' | 'ldap'; must_change?: number; login?: string; travel_fee_cents?: number | null };
export type Client = { glpi_entity_id: number | null; color: string | null; id: string; name: string; active: number; hourly_rate_cents: number | null; onsite_hourly_rate_cents: number | null };
import type { TicketSource } from './ticket-selection';
export type Entry = { id: string; member_id: string; client_id: string; client: string; member: string; ticket: string; ticket_source: TicketSource; glpi_ticket_id: number | null; date: string; start: number; end: number; description: string; on_site: number | null; hourly_rate_cents: number | null; travel_cents: number | null; travel_counted: number; billed: number; version: number };
export type State = { me: Member | null; setup?: boolean; denied?: boolean; email?: string; clients: Client[]; members: Member[]; entries: Entry[] };

export type WorkTimer = { id: string; member_id: string; client_id: string; client: string; color: string | null; ticket: string; ticket_source: TicketSource; glpi_ticket_id: number | null; description: string; on_site: number; started_at: number; stopped_at: number | null; version: number };
export type Workday = { today: string; weekStart: string; week: Entry[]; recent: Entry[]; timer: WorkTimer | null; segments: { date: string; start: number; end: number }[]; warning: string };
export type EntrySeed = { client_id?: string; ticket?: string; ticket_source?: TicketSource; glpi_ticket_id?: number | null; description?: string; on_site?: boolean; date?: string; start?: string; end?: string };
