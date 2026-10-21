import { sqliteTable, text, integer, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
export const members = sqliteTable('members', {
  id: text('id').primaryKey(), userId: text('user_id'), email: text('email').notNull(),
  name: text('name').notNull(), role: text('role').notNull().default('partner'),
  travelFeeCents: integer('travel_fee_cents'),
  active: integer('active').notNull().default(1), createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('members_email_unique').on(t.email), uniqueIndex('members_user_unique').on(t.userId)]);
export const clients = sqliteTable('clients', {
  color: text('color'),
  glpiEntityId: integer('glpi_entity_id'),
  hourlyRateCents: integer('hourly_rate_cents'), onsiteHourlyRateCents: integer('onsite_hourly_rate_cents'),
  id: text('id').primaryKey(), name: text('name').notNull(), active: integer('active').notNull().default(1),
}, t => [uniqueIndex('clients_name_unique').on(t.name)]);
export const entries = sqliteTable('entries', {
  id: text('id').primaryKey(), memberId: text('member_id').notNull().references(() => members.id),
  clientId: text('client_id').notNull().references(() => clients.id), ticket: text('ticket').notNull(),
  ticketTitle: text('ticket_title'), ticketSource: text('ticket_source').notNull().default('legacy'), glpiTicketId: integer('glpi_ticket_id'),
  date: text('date').notNull(), start: integer('start').notNull(), end: integer('end').notNull(),
  description: text('description').notNull().default(''), billed: integer('billed').notNull().default(0),
  onSite: integer('on_site'), hourlyRateCents: integer('hourly_rate_cents'),
  version: integer('version').notNull().default(1), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [index('entries_member_date').on(t.memberId, t.date), index('entries_date_client').on(t.date, t.clientId)]);

export const providerRates = sqliteTable('provider_rates', {
  memberId: text('member_id').notNull().references(() => members.id),
  effectiveFrom: text('effective_from').notNull(), hourlyRateCents: integer('hourly_rate_cents'),
  version: integer('version').notNull().default(1), actorId: text('actor_id').notNull().references(() => members.id), updatedAt: text('updated_at').notNull(),
}, t => [primaryKey({ columns: [t.memberId, t.effectiveFrom] })]);
export const providerRateEvents = sqliteTable('provider_rate_events', {
  id: text('id').primaryKey(), memberId: text('member_id').notNull().references(() => members.id), actorId: text('actor_id').notNull().references(() => members.id),
  effectiveFrom: text('effective_from').notNull(), previousRateCents: integer('previous_rate_cents'), newRateCents: integer('new_rate_cents'), version: integer('version').notNull(), createdAt: text('created_at').notNull(),
}, t => [index('provider_rate_events_member').on(t.memberId, t.createdAt)]);
