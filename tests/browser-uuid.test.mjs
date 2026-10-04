import test from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_UUID_UNAVAILABLE_MESSAGE, BrowserUuidUnavailableError, browserUuidV4 } from '../lib/browser-uuid.ts';

function withCrypto(value, run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value });
  try { return run(); }
  finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
  }
}

test('browserUuidV4 prefers the native implementation and normalizes lowercase', () => {
  const native = {
    randomUUID() {
      assert.equal(this, native, 'native randomUUID must keep its Crypto receiver');
      return 'AABBCCDD-EEFF-4ABC-8DEF-AABBCCDDEEFF';
    },
    getRandomValues() { throw new Error('fallback must not run'); },
  };
  withCrypto(native, () => assert.equal(browserUuidV4(), 'aabbccdd-eeff-4abc-8def-aabbccddeeff'));
});

test('browserUuidV4 uses getRandomValues when randomUUID is absent and sets RFC 4122 v4 bits', () => {
  const fallback = {
    getRandomValues(bytes) {
      assert.equal(this, fallback, 'getRandomValues must keep its Crypto receiver');
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = 0xf0 + index;
      return bytes;
    },
  };
  withCrypto(fallback, () => {
    const uuid = browserUuidV4();
    assert.equal(uuid, 'f0f1f2f3-f4f5-46f7-b8f9-fafbfcfdfeff');
    assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

test('browserUuidV4 fails closed without a CSPRNG and never calls Math.random', () => {
  const originalRandom = Math.random;
  Math.random = () => { throw new Error('Math.random must never be used'); };
  try {
    withCrypto(undefined, () => assert.throws(
      () => browserUuidV4(),
      error => error instanceof BrowserUuidUnavailableError && error.message === BROWSER_UUID_UNAVAILABLE_MESSAGE,
    ));
  } finally {
    Math.random = originalRandom;
  }
});
