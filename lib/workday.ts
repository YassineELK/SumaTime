const civil = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function brusselsMoment(timestamp: number) {
  const parts = Object.fromEntries(civil.formatToParts(timestamp).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) };
}
export type TimerSegment = { date: string; start: number; end: number };
export function timerSegments(started: number, stopped: number): TimerSegment[] {
  if (!Number.isFinite(started) || !Number.isFinite(stopped) || stopped < started) throw new Error('Les horaires du chronomètre sont invalides.');
  if (stopped - started > 24 * 3600000) throw new Error('Ce chronomètre dépasse 24 heures. Saisissez les horaires réels manuellement avant de le supprimer.');
  const from = Math.floor(started / 60000) * 60000;
  const to = Math.max(from + 60000, Math.ceil(stopped / 60000) * 60000);
  const segments: TimerSegment[] = [];
  for (let instant = from; instant < to; instant += 60000) {
    const now = brusselsMoment(instant), next = brusselsMoment(instant + 60000);
    const end = next.date !== now.date ? 1440 : next.minute;
    if (end - now.minute !== 1 || (next.date !== now.date && next.minute !== 0)) throw new Error('Ce chronomètre traverse un changement d’heure. Vérifiez et saisissez les horaires manuellement avant de le supprimer.');
    const last = segments.at(-1);
    if (last?.date === now.date) last.end = end;
    else segments.push({ date: now.date, start: now.minute, end });
  }
  return segments;
}
export function suggestedTimes(timestamp = Date.now()) {
  const now = brusselsMoment(timestamp);
  const start = Math.min(1425, Math.floor(now.minute / 15) * 15);
  const clock = (minute: number) => minute === 1440 ? '00:00' : `${Math.floor(minute / 60)}`.padStart(2, '0') + ':' + `${minute % 60}`.padStart(2, '0');
  return { date: now.date, start: clock(start), end: clock(start + 15) };
}
