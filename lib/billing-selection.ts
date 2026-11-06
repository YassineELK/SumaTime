export const MAX_BILLING_BATCH = 1000;
export type BillingItem = { id: string; version: number };
export type BillingSelection = Record<string, number>;
export function billingItems(value: unknown): BillingItem[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_BILLING_BATCH) throw new Error(`Sélectionnez de 1 à ${MAX_BILLING_BATCH} prestations.`);
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim() || item.id.length > 100 || !Number.isSafeInteger(item.version) || item.version < 1 || ids.has(item.id)) throw new Error('Sélection invalide ou dupliquée. Actualisez le relevé.');
    ids.add(item.id); return { id: item.id, version: item.version };
  });
}
