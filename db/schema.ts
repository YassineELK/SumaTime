import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const members = sqliteTable('members', {
  id: text('id').primaryKey(), userId: text('user_id'), email: text('email').notNull(),
  name: text('name').notNull(), role: text('role').notNull().default('partner'),
  active: integer('active').notNull().default(1), createdAt: text('created_at').notNull(),
}, t => [uniqueIndex('members_email_unique').on(t.email), uniqueIndex('members_user_unique').on(t.userId)]);
export const clients = sqliteTable('clients', {
  id: text('id').primaryKey(), name: text('name').notNull(), active: integer('active').notNull().default(1),
}, t => [uniqueIndex('clients_name_unique').on(t.name)]);
export const entries = sqliteTable('entries', {
  id: text('id').primaryKey(), memberId: text('member_id').notNull().references(() => members.id),
  clientId: text('client_id').notNull().references(() => clients.id), ticket: text('ticket').notNull(),
  date: text('date').notNull(), start: integer('start').notNull(), end: integer('end').notNull(),
  description: text('description').notNull().default(''), billed: integer('billed').notNull().default(0),
  version: integer('version').notNull().default(1), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [index('entries_member_date').on(t.memberId, t.date), index('entries_date_client').on(t.date, t.clientId)]);
