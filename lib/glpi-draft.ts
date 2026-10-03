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
type StoredRequests = { version: 2; requests: PendingGlpiRequest[] };
export type GlpiDraftStorageStatus = 'ok' | 'unavailable' | 'corrupt' | 'quota';
export type GlpiDraftStorageResult = { ok: true } | { ok: false; reason: Exclude<GlpiDraftStorageStatus, 'ok'> };
type StorageRead = { status: GlpiDraftStorageStatus; store: StoredRequests };
type DraftListener = (pending: PendingGlpiRequest | null) => void;

/**
 * The anonymous key is retained only for isolated component tests and callers
 * that have not supplied an authenticated member id. Production callers always
 * pass the member id and therefore use a private namespace.
 */
export const GLPI_UNCERTAIN_STORAGE_KEY = 'sumatoni-glpi-uncertain-v2:anonymous';
export const GLPI_UNCERTAIN_STORAGE_NAMESPACE = 'sumatoni-glpi-uncertain-v2:';
export const GLPI_UNCERTAIN_LEGACY_STORAGE_KEY = 'sumatoni-glpi-uncertain-v1';
export const GLPI_UNCERTAIN_MAX_REQUESTS = 4;
export const GLPI_UNCERTAIN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_STORAGE_BYTES = 32_000;
const UUID = /^[a-f0-9-]{36}$/;
const sourceId = `sumatoni-${Math.random().toString(36).slice(2)}`;
const listeners = new Map<string, Set<DraftListener>>();
const channels = new Map<string, { channel: BroadcastChannel; references: number }>();

function browserStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function memberStorageKey(memberId = '') {
  return memberId ? GLPI_UNCERTAIN_STORAGE_NAMESPACE + encodeURIComponent(memberId) : GLPI_UNCERTAIN_STORAGE_KEY;
}

export function glpiUncertainStorageKey(memberId = '') {
  return memberStorageKey(memberId);
}

function emptyStore(): StoredRequests {
  return { version: 2, requests: [] };
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

function pending(value: unknown): value is PendingGlpiRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as { payload?: unknown; savedAt?: unknown };
  return payload(candidate.payload) && typeof candidate.savedAt === 'number'
    && Number.isFinite(candidate.savedAt) && candidate.savedAt > Date.now() - GLPI_UNCERTAIN_TTL_MS;
}

function readStore(storage: StorageLike | null, memberId = ''): StorageRead {
  if (!storage) return { status: 'unavailable', store: emptyStore() };
  try {
    // The old key was global. It cannot be safely attributed to a member, so
    // remove it rather than allowing a later account to read another user's
    // title, description or UUID.
    storage.removeItem(GLPI_UNCERTAIN_LEGACY_STORAGE_KEY);
    const raw = storage.getItem(memberStorageKey(memberId));
    if (raw === null) return { status: 'ok', store: emptyStore() };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { status: 'corrupt', store: emptyStore() };
    const value = parsed as { version?: unknown; requests?: unknown };
    if (value.version !== 2 || !Array.isArray(value.requests) || value.requests.some(item => !pending(item))) {
      return { status: 'corrupt', store: emptyStore() };
    }
    const requests = value.requests
      .filter((item): item is PendingGlpiRequest => pending(item))
      .sort((left, right) => right.savedAt - left.savedAt)
      .slice(0, GLPI_UNCERTAIN_MAX_REQUESTS);
    return { status: 'ok', store: { version: 2, requests } };
  } catch {
    return { status: 'unavailable', store: emptyStore() };
  }
}

function writeStore(storage: StorageLike | null, store: StoredRequests, memberId = ''): GlpiDraftStorageResult {
  if (!storage) return { ok: false, reason: 'unavailable' };
  try {
    const serialized = JSON.stringify(store);
    const bytes = typeof TextEncoder === 'undefined' ? serialized.length : new TextEncoder().encode(serialized).byteLength;
    if (bytes > MAX_STORAGE_BYTES) return { ok: false, reason: 'quota' };
    storage.setItem(memberStorageKey(memberId), serialized);
    return { ok: true };
  } catch (error) {
    const name = error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : '';
    return { ok: false, reason: name === 'QuotaExceededError' ? 'quota' : 'unavailable' };
  }
}

export function getGlpiDraftStorageStatus(memberId = '', storage: StorageLike | null | undefined = browserStorage()): GlpiDraftStorageStatus {
  return readStore(storage ?? browserStorage(), memberId).status;
}

export function readPendingGlpiRequest(clientId = '', description = '', storage: StorageLike | null | undefined = browserStorage(), memberId = ''): PendingGlpiRequest | null {
  const requests = readStore(storage ?? browserStorage(), memberId).store.requests;
  if (!requests.length) return null;
  const normalizedDescription = description.trim();
  const exact = requests.find(item => (!clientId || item.payload.client_id === clientId)
    && (!normalizedDescription || item.payload.description === normalizedDescription));
  if (exact) return exact;
  if (clientId) return requests.find(item => item.payload.client_id === clientId) || null;
  return requests[0] || null;
}

function emit(memberId: string, value: PendingGlpiRequest | null) {
  listeners.get(memberStorageKey(memberId))?.forEach(listener => listener(value));
}

function channelFor(memberId: string) {
  if (typeof BroadcastChannel === 'undefined') return null;
  const key = memberStorageKey(memberId);
  const existing = channels.get(key);
  if (existing) {
    existing.references += 1;
    return existing.channel;
  }
  let channel: BroadcastChannel;
  try { channel = new BroadcastChannel(key); } catch { return null; }
  try {
    channel.addEventListener('message', event => {
      const message = event.data as { source?: unknown; kind?: unknown; payload?: unknown } | null;
      if (!message || message.source === sourceId) return;
      if (message.kind === 'remove') emit(memberId, null);
      else if (message.kind === 'upsert' && pending({ payload: message.payload, savedAt: Date.now() })) {
        emit(memberId, { payload: message.payload as GlpiRequestPayload, savedAt: Date.now() });
      }
    });
  } catch { try { channel.close(); } catch {} return null; }
  channels.set(key, { channel, references: 1 });
  return channel;
}

function announce(memberId: string, value: PendingGlpiRequest | null) {
  emit(memberId, value);
  const key = memberStorageKey(memberId);
  const channel = channels.get(key)?.channel || (listeners.get(key)?.size ? channelFor(memberId) : null);
  try { channel?.postMessage({ source: sourceId, kind: value ? 'upsert' : 'remove', payload: value?.payload }); } catch {}
}

export function announcePendingGlpiRequest(memberId: string, value: PendingGlpiRequest | null) {
  announce(memberId, value);
}

export function subscribePendingGlpiRequest(memberId: string, listener: DraftListener) {
  const key = memberStorageKey(memberId);
  let memberListeners = listeners.get(key);
  if (!memberListeners) {
    memberListeners = new Set();
    listeners.set(key, memberListeners);
  }
  memberListeners.add(listener);
  const channel = channelFor(memberId);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== key) return;
    listener(readPendingGlpiRequest('', '', browserStorage(), memberId));
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    memberListeners?.delete(listener);
    if (memberListeners?.size === 0) listeners.delete(key);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
    const current = channels.get(key);
    if (current && channel) {
      current.references -= 1;
      if (current.references <= 0) {
        try { current.channel.close(); } catch {}
        channels.delete(key);
      }
    }
  };
}

export function savePendingGlpiRequest(value: GlpiRequestPayload, storage: StorageLike | null | undefined = browserStorage(), memberId = ''): GlpiDraftStorageResult {
  if (!payload(value)) return { ok: false, reason: 'corrupt' };
  const target = storage ?? browserStorage();
  const current = readStore(target, memberId);
  if (current.status !== 'ok') return { ok: false, reason: current.status };
  const requests = current.store.requests.filter(item => item.payload.request_id !== value.request_id);
  requests.unshift({ payload: { ...value }, savedAt: Date.now() });
  const result = writeStore(target, { version: 2, requests: requests.slice(0, GLPI_UNCERTAIN_MAX_REQUESTS) }, memberId);
  if (result.ok) announce(memberId, { payload: { ...value }, savedAt: Date.now() });
  return result;
}

export function removePendingGlpiRequest(requestId: string, storage: StorageLike | null | undefined = browserStorage(), memberId = ''): GlpiDraftStorageResult {
  const target = storage ?? browserStorage();
  const current = readStore(target, memberId);
  if (current.status !== 'ok') return { ok: false, reason: current.status };
  const requests = current.store.requests.filter(item => item.payload.request_id !== requestId);
  let result: GlpiDraftStorageResult;
  try {
    if (requests.length) result = writeStore(target, { version: 2, requests }, memberId);
    else {
      target?.removeItem(memberStorageKey(memberId));
      result = { ok: true };
    }
  } catch {
    result = { ok: false, reason: 'unavailable' };
  }
  if (result.ok) announce(memberId, null);
  return result;
}
