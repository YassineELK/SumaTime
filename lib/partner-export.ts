import { billedMinutes, clockTime, locationLabel } from './business';
import { serviceAmount } from './pricing';
import type { Entry } from './types';

// Supplier reconciliation uses recorded time and supplier travel fees, never client sale rates.
export function partnerStatement(rows: Entry[], partnerName: string): unknown[][] {
  const decimal = (value: number) => value.toFixed(2).replace('.', ',');
  let real = 0, rounded = 0, trips = 0, fees = 0, missingFees = 0, unknownModes = 0, remuneration = 0, missingRates = 0;
  const table: unknown[][] = [['Prestataire', 'Client', 'Date', 'Début', 'Fin', 'Ticket', 'Description', 'Mode de prestation', 'Minutes réelles', 'Minutes arrondies (quart d’heure)', 'Heures arrondies (quart d’heure)', 'Déplacements', 'Forfait prestataire EUR', 'À vérifier', 'Tarif prestataire EUR HT', 'Rémunération prestataire EUR HT', 'Total avec déplacements EUR HT']];
  for (const row of [...rows].sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start || a.client.localeCompare(b.client) || a.id.localeCompare(b.id))) {
    const minutes = billedMinutes(row.start, row.end);
    const missing = row.travel_counted === 1 && row.travel_cents === null;
    const unknown = row.on_site === null;
    const rate = row.provider_rate_cents ?? null, amount = serviceAmount(row.start, row.end, rate);
    remuneration += amount ?? 0; missingRates += Number(amount === null);
    real += row.end - row.start; rounded += minutes; trips += row.travel_counted;
    fees += row.travel_cents ?? 0; missingFees += Number(missing); unknownModes += Number(unknown);
    table.push([partnerName, row.client, row.date, clockTime(row.start), clockTime(row.end), row.ticket, row.description, locationLabel(row.on_site), row.end - row.start, minutes, decimal(minutes / 60), row.travel_counted, missing ? '' : decimal((row.travel_cents ?? 0) / 100), [missing ? 'Forfait non renseigné' : '', unknown ? 'Mode à confirmer' : '', amount === null ? 'Tarif prestataire non renseigné' : ''].filter(Boolean).join(' · '), rate === null ? '' : decimal(rate / 100), amount === null ? '' : decimal(amount / 100), amount === null || missing || unknown ? '' : decimal((amount + (row.travel_cents ?? 0)) / 100)]);
  }
  const checks = [missingRates ? `${missingRates} tarif(s) prestataire non renseigné(s)` : '', missingFees ? `${missingFees} forfait(s) non renseigné(s)` : '', unknownModes ? `${unknownModes} mode(s) à confirmer ; déplacements potentiellement incomplets` : ''].filter(Boolean).join(' · ');
  table.push([partnerName, 'TOTAL', '', '', '', '', `${rows.length} prestation(s)`, '', real, rounded, decimal(rounded / 60), trips, missingFees || unknownModes ? '' : decimal(fees / 100), checks, '', missingRates ? '' : decimal(remuneration / 100), missingRates || missingFees || unknownModes ? '' : decimal((remuneration + fees) / 100)]);
  return table;
}
