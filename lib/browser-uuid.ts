export const BROWSER_UUID_UNAVAILABLE_MESSAGE = 'Ce navigateur ne peut pas créer un identifiant sécurisé. Ouvrez Sumatoni Time en HTTPS ou utilisez un navigateur récent, puis réessayez.';

export class BrowserUuidUnavailableError extends Error {
  constructor() {
    super(BROWSER_UUID_UNAVAILABLE_MESSAGE);
    this.name = 'BrowserUuidUnavailableError';
  }
}

export function browserUuidV4(): string {
  const secureCrypto = globalThis.crypto;
  if (typeof secureCrypto?.randomUUID === 'function') {
    try {
      return secureCrypto.randomUUID.call(secureCrypto).toLowerCase();
    } catch {
      // Some browser policies expose randomUUID but reject the call. The
      // lower-level CSPRNG is still a safe RFC 4122 v4 fallback when present.
    }
  }

  if (typeof secureCrypto?.getRandomValues !== 'function') {
    throw new BrowserUuidUnavailableError();
  }

  const bytes = new Uint8Array(16);
  try {
    secureCrypto.getRandomValues.call(secureCrypto, bytes);
  } catch {
    throw new BrowserUuidUnavailableError();
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
