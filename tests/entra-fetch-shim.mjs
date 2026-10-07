import { readFileSync } from 'node:fs';
// Test process only. No endpoint override or TLS bypass exists in application code.
const base = new URL(process.env.TEST_MOCK_MICROSOFT);
if (base.hostname !== '127.0.0.1' || base.protocol !== 'http:') throw new Error('Mock must be loopback');
const original = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.origin === 'https://login.microsoftonline.com') {
    const local = new URL(url.pathname + url.search, base);
    return original(local, options);
  }
  if (url.origin === 'https://graph.microsoft.com') return original(new URL('/graph' + url.pathname + url.search, base), options);
  return original(input, options);
};

// Test-only clock acceleration for cache-expiry/revocation checks.
if (process.env.TEST_CLOCK_FILE) {
  const realNow = Date.now;
  Date.now = () => realNow() + Number(readFileSync(process.env.TEST_CLOCK_FILE, 'utf8'));
}
