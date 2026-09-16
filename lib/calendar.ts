import type { Entry } from './types';

export const SLOT_MINUTES = 15;
export const SLOT_HEIGHT = 24;
export const SLOT_COUNT = 96;
export function addDays(date: string, days: number) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function weekStart(date: string) {
  const day = new Date(date + 'T12:00:00Z').getUTCDay();
  return addDays(date, -(day + 6) % 7);
}
export function slotAt(y: number, top: number, height: number) {
  return Math.max(0, Math.min(SLOT_COUNT - 1, Math.floor((y - top) / height * SLOT_COUNT)));
}
export function selectedRange(a: number, b: number) {
  const first = Math.max(0, Math.min(95, Math.floor(Math.min(a, b))));
  const last = Math.max(0, Math.min(95, Math.floor(Math.max(a, b))));
  return { start: first * SLOT_MINUTES, end: (last + 1) * SLOT_MINUTES };
}
export function overlaps(start: number, end: number, entries: Entry[], member: string, date: string, except = '') {
  return entries.some(e => e.id !== except && e.member_id === member && e.date === date && e.start < end && e.end > start);
}
// Pack simultaneous entries into independent lanes when an admin views the team.
export function layoutEntries(entries: Entry[], minimumVisibleMinutes = 0) {
  const sorted = [...entries].sort((a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id));
  const result: { entry: Entry; lane: number; lanes: number }[] = [];
  let group: typeof result = [], ends: number[] = [], groupEnd = -1;
  function finish() { for (const item of group) { item.lanes = ends.length; result.push(item); } group = []; ends = []; }
  for (const entry of sorted) {
    if (entry.start >= groupEnd) finish();
    const available = ends.findIndex(end => end <= entry.start);
    const lane = available < 0 ? ends.length : available;
    ends[lane] = Math.max(entry.end, entry.start + minimumVisibleMinutes);
    group.push({ entry, lane, lanes: 1 });
    groupEnd = Math.max(...ends);
  }
  finish();
  return result;
}
