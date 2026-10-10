import type { Entry, Member } from '@/lib/types';
import { euro, serviceAmount } from '@/lib/pricing';
export default function EntryAmount({ entry, role }: { entry: Entry; role: Member['role'] }) {
  const admin = role === 'admin';
  const rate = admin ? entry.hourly_rate_cents : entry.provider_rate_cents ?? null;
  return <small>{admin ? 'Prestation client' : 'Mon montant HT'} : {euro(serviceAmount(entry.start, entry.end, rate))}</small>;
}
