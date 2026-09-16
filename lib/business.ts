export function billedMinutes(start: number, end: number) { return Math.ceil((end - start) / 15) * 15; }
export function locationLabel(onSite: number | boolean | null) { return onSite === null ? 'À confirmer' : onSite ? 'Sur site' : 'À distance'; }
export function clockTime(minutes: number) { return `${Math.floor(minutes / 60).toString().padStart(2, '0')}:${(minutes % 60).toString().padStart(2, '0')}`; }
export function duration(minutes: number) { return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`; }
export function brusselsToday() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export function validDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
export function parseTime(value: unknown) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Les heures doivent être au format HH:MM.');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
}
export function csvCell(value: unknown) {
  let str = String(value ?? '');
  if (/^[\s]*[=+@\-]/.test(str) || /^[\t\r\n]/.test(str)) str = "'" + str;
  return '"' + str.replaceAll('"', '""') + '"';
}
export function csv(rows: unknown[][]) { return '\ufeff' + rows.map(row => row.map(csvCell).join(';')).join('\r\n'); }
