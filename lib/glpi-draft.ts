export type GlpiRequestPayload = {
  request_id: string;
  client_id: string;
  title: string;
  description: string;
  type: number;
  urgency: number;
  category: number;
};

export type PendingGlpiRequest = {
  payload: GlpiRequestPayload;
  savedAt: number;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type StoredRequests = { version: 1; requests: PendingGlpiRequest[] };

export const GLPI_UNCERTAIN_STORAGE_KEY = 'sumatoni-glpi-uncertain-v1';
export const GLPI_UNCERTAIN_MAX_REQUESTS = 4;
export const GLPI_UNCERTAIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STORAGE_BYTES = 32_000;
const UUID = /^[a-f0-9-]{36}$/;

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function payload(value: unknown): value is GlpiRequestPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<GlpiRequestPayload>;
  const urgency = candidate.urgency;
  const category = candidate.category;
  return typeof candidate.request_id === 'string' && UUID.test(candidate.request_id)
    && typeof candidate.client_id === 'string' && candidate.client_id.length <= 120
    && typeof candidate.title === 'string' && candidate.title.length <= 250
    && typeof candidate.description === 'string' && candidate.description.length <= 4000
    && (candidate.type === 1 || candidate.type === 2)
    && typeof urgency === 'number' && Number.isSafeInteger(urgency) && urgency >= 1 && urgency <= 5
    && typeof category === 'number' && Number.isSafeInteger(category) && category >= 0;
}

function readStore(storage: StorageLike | null): StoredRequests {
  if (!storage) return { version: 1, requests: [] };
  try {
    const parsed: unknown = JSON.parse(storage.getItem(GLPI_UNCERTAIN_STORAGE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { version: 1, requests: [] };
    const value = parsed as { version?: unknown; requests?: unknown };
    if (value.version !== 1 || !Array.isArray(value.requests)) return { version: 1, requests: [] };
    const now = Date.now();
    const requests = value.requests.filter((item): item is PendingGlpiRequest => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
      const candidate = item as { payload?: unknown; savedAt?: unknown };
      return payload(candidate.payload) && typeof candidate.savedAt === 'number'
        && Number.isFinite(candidate.savedAt) && candidate.savedAt > now - GLPI_UNCERTAIN_TTL_MS;
    }).sort((left, right) => right.savedAt - left.savedAt).slice(0, GLPI_UNCERTAIN_MAX_REQUESTS);
    return { version: 1, requests };
  } catch {
    return { version: 1, requests: [] };
  }
}

function writeStore(storage: StorageLike | null, store: StoredRequests) {
  if (!storage) return;
  try {
    const serialized = JSON.stringify(store);
    if (serialized.length > MAX_STORAGE_BYTES) return;
    storage.setItem(GLPI_UNCERTAIN_STORAGE_KEY, serialized);
  } catch {
    // Losing local persistence is handled by the caller's conservative UI state.
  }
}

export function readPendingGlpiRequest(clientId = '', description = '', storage: StorageLike | null = browserStorage()): PendingGlpiRequest | null {
  const requests = readStore(storage).requests;
  if (!requests.length) return null;
  const normalizedDescription = description.trim();
  const exact = requests.find(item => (!clientId || item.payload.client_id === clientId)
    && (!normalizedDescription || item.payload.description === normalizedDescription));
  if (exact) return exact;
  if (clientId) return requests.find(item => item.payload.client_id === clientId) || null;
  return requests[0] || null;
}

export function savePendingGlpiRequest(value: GlpiRequestPayload, storage: StorageLike | null = browserStorage()) {
  if (!payload(value)) return;
  const requests = readStore(storage).requests.filter(item => item.payload.request_id !== value.request_id);
  requests.unshift({ payload: { ...value }, savedAt: Date.now() });
  writeStore(storage, { version: 1, requests: requests.slice(0, GLPI_UNCERTAIN_MAX_REQUESTS) });
}

export function removePendingGlpiRequest(requestId: string, storage: StorageLike | null = browserStorage()) {
  const requests = readStore(storage).requests.filter(item => item.payload.request_id !== requestId);
  if (requests.length) writeStore(storage, { version: 1, requests });
  else {
    try { storage?.removeItem(GLPI_UNCERTAIN_STORAGE_KEY); } catch {
      // Storage can disappear between the read and remove (private browsing).
    }
  }
}
