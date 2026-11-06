export type ExportKind = 'client' | 'detail' | 'summary' | 'partner';
export function filenameSlug(name: string) {
  return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/g, '') || 'client';
}
export function exportFilename({ kind, from, to, clientName, partnerName }: { kind: ExportKind; from: string; to: string; clientName?: string | null; partnerName?: string | null }) {
  const client = clientName ? filenameSlug(clientName) : 'tous-les-clients';
  const suffix = kind === 'client' ? '' : kind === 'detail' ? '-detail' : kind === 'summary' ? '-synthese' : '-prestataire-' + filenameSlug(partnerName || 'prestataire');
  return `${client}-prestations${suffix}-${from}-${to}.csv`;
}
export function responseFilename(disposition: string | null): string | null {
  if (!disposition) return null;
  const match = /(?:^|;)\s*filename\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(disposition);
  const candidate = (match?.[1] || match?.[2] || '').trim();
  return candidate.length <= 240 && /^[a-z0-9][a-z0-9-]*\.csv$/i.test(candidate) ? candidate : null;
}
