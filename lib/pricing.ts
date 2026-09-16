import { billedMinutes } from './business';
export function amountCents(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{1,6}([.,]\d{1,2})?$/.test(value.trim())) throw new Error('Montant non valide : utilisez un nombre positif avec deux décimales maximum.');
  const [whole, fraction = ''] = value.trim().replace(',', '.').split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function amountInput(cents: number | null | undefined) { return cents == null ? '' : (cents / 100).toFixed(2); }
export function euro(cents: number | null | undefined) { return cents == null ? 'Non renseigné' : (cents / 100).toLocaleString('fr-BE', { style: 'currency', currency: 'EUR' }); }
export function serviceAmount(start: number, end: number, hourlyRate: number | null) { return hourlyRate === null ? null : Math.round(billedMinutes(start, end) * hourlyRate / 60); }
