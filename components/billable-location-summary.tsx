import type { Entry } from '@/lib/types';
import { billedMinutes, duration } from '@/lib/business';
export function billableLocationMinutes(entries: Pick<Entry, 'start' | 'end' | 'on_site'>[]) {
  let onSite = 0, remote = 0, unconfirmed = 0;
  for (const entry of entries) {
    const minutes = billedMinutes(entry.start, entry.end);
    if (entry.on_site === 1) onSite += minutes;
    else if (entry.on_site === 0) remote += minutes;
    else unconfirmed += minutes;
  }
  return { onSite, remote, unconfirmed };
}
export default function BillableLocationSummary({ entries }: { entries: Pick<Entry, 'start' | 'end' | 'on_site'>[] }) {
  const { onSite, remote, unconfirmed } = billableLocationMinutes(entries);
  return <small className="location-breakdown" aria-label="Répartition des heures facturables"><span>Sur site : <strong>{duration(onSite)}</strong></span><span>À distance : <strong>{duration(remote)}</strong></span>{unconfirmed > 0 && <span>À confirmer : <strong>{duration(unconfirmed)}</strong></span>}</small>;
}
