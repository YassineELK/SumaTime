import test from 'node:test';
import assert from 'node:assert/strict';
import { GLPI_TERMINAL_ERROR_CODES, isTerminalGlpiFailure } from '../lib/glpi-contract.ts';

test('creation/recovery error contract has explicit terminal vocabulary and fails closed by default', () => {
  assert.deepEqual([...GLPI_TERMINAL_ERROR_CODES], ['CREATION_REJECTED', 'DISTINCT_REQUIRED', 'INTENT_CONSUMED', 'INTENT_ABANDONED']);
  for (const value of [
    { code: 'CONFIG_NOT_READY', terminal: false, retryable: true, preserveOperation: true },
    { code: 'AUTH_REQUIRED', terminal: false, retryable: true, preserveOperation: true },
    { code: 'RATE_LIMITED', terminal: false, retryable: true, preserveOperation: true },
    { code: 'GLPI_UNAVAILABLE', terminal: false, retryable: true, preserveOperation: true },
    { code: 'GLPI_RESPONSE_INVALID', terminal: false, retryable: true, preserveOperation: true },
    { code: 'unknown-status', terminal: true, retryable: false, preserveOperation: false },
    {},
  ]) assert.equal(isTerminalGlpiFailure(value), false, `must preserve ${value.code || 'unknown'} by default`);
  assert.equal(isTerminalGlpiFailure({ code: 'CREATION_REJECTED', terminal: true, retryable: false, preserveOperation: false }), true);
  assert.equal(isTerminalGlpiFailure({ code: 'DISTINCT_REQUIRED', terminal: true, retryable: false, preserveOperation: false }, true), false, 'a capability cannot disappear without server consumption proof');
  assert.equal(isTerminalGlpiFailure({ code: 'DISTINCT_REQUIRED', terminal: true, retryable: false, preserveOperation: false, intent_consumed: true }, true), true);
});
