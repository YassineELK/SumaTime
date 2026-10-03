const civil = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function brusselsMoment(timestamp: number) {
  const parts = Object.fromEntries(civil.formatToParts(timestamp).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}
export type TimerSegment = { date: string; start: number; end: number };
function civilMinuteIndex(moment: ReturnType<typeof brusselsMoment>) {
  return Date.parse(moment.date + 'T00:00:00Z') / 60000 + moment.minute;
}
function offsetMinute(timestamp: number) {
  return civilMinuteIndex(brusselsMoment(timestamp)) - Math.floor(timestamp / 60000);
}
export function timerSegments(started: number, stopped: number): TimerSegment[] {
  if (!Number.isFinite(started) || !Number.isFinite(stopped) || stopped < started) throw new Error('Les horaires du chronomètre sont invalides.');
  if (stopped - started > 24 * 3600000) throw new Error('Ce chronomètre dépasse 24 heures. Saisissez les horaires réels manuellement avant de le supprimer.');
  // Validate the measured interval first. Rounded civil bounds can straddle a
  // nonexistent hour even when the actual intervention did not.
  const measuredStartOffset = offsetMinute(started);
  const measuredEndOffset = offsetMinute(Math.max(started, stopped - 1));
  if (measuredStartOffset !== measuredEndOffset) throw new Error('Ce chronomètre traverse un changement d’heure. Vérifiez et saisissez les horaires manuellement avant de le supprimer.');

  // Round the displayed civil values, not the UTC instants. This keeps the
  // proposed editable bounds useful around DST and retains the existing
  // quarter-hour and midnight rules.
  const quarter = 15;
  const measuredFrom = civilMinuteIndex(brusselsMoment(started));
  const stoppedMinuteRemainder = ((stopped % 60000) + 60000) % 60000;
  const measuredTo = civilMinuteIndex(brusselsMoment(stopped)) + (stoppedMinuteRemainder === 0 ? 0 : 1);
  const from = Math.floor(measuredFrom / quarter) * quarter;
  const to = Math.max(from + quarter, Math.ceil(measuredTo / quarter) * quarter);
  const segments: TimerSegment[] = [];
  let cursor = from;
  while (cursor < to) {
    const date = new Date(cursor * 60000).toISOString().slice(0, 10);
    const dayStart = Date.parse(date + 'T00:00:00Z') / 60000;
    const nextDay = dayStart + 1440;
    const end = Math.min(to, nextDay) - dayStart;
    segments.push({ date, start: cursor - dayStart, end });
    cursor = dayStart + end;
  }
  return segments;
}
export function suggestedTimes(timestamp = Date.now()) {
  const now = brusselsMoment(timestamp);
  const start = Math.min(1425, Math.floor(now.minute / 15) * 15);
  const clock = (minute: number) => minute === 1440 ? '00:00' : `${Math.floor(minute / 60)}`.padStart(2, '0') + ':' + `${minute % 60}`.padStart(2, '0');
  return { date: now.date, start: clock(start), end: clock(start + 15) };
}
