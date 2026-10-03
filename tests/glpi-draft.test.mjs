import test from 'node:test';
import assert from 'node:assert/strict';
import { GLPI_UNCERTAIN_MAX_REQUESTS, GLPI_UNCERTAIN_STORAGE_KEY, getGlpiDraftStorageStatus, glpiUncertainStorageKey, readPendingGlpiRequest, removePendingGlpiRequest, savePendingGlpiRequest } from '../lib/glpi-draft.ts';

function storage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
    values,
  };
}

const payload = (request_id, description = 'Description canonique') => ({ request_id, client_id: 'client-1', title: 'Titre canonique', description, type: 1, urgency: 3, category: 1 });

test('uncertain GLPI identity survives storage remounts and distinct requests do not erase it', () => {
  const target = storage();
  const first = payload('11111111-1111-1111-1111-111111111111');
  const second = payload('22222222-2222-2222-2222-222222222222', 'Second request');
  savePendingGlpiRequest(first, target);
  assert.deepEqual(readPendingGlpiRequest('client-1', first.description, target)?.payload, first);
  // A distinct explicit request is a second record; it cannot mutate the
  // uncertain request that must remain recoverable after a remount.
  savePendingGlpiRequest(second, target);
  assert.deepEqual(readPendingGlpiRequest('client-1', first.description, target)?.payload, first);
  assert.deepEqual(readPendingGlpiRequest('client-1', second.description, target)?.payload, second);
  removePendingGlpiRequest(second.request_id, target);
  assert.deepEqual(readPendingGlpiRequest('client-1', first.description, target)?.payload, first);
});

test('uncertain storage is bounded, expires invalid data, and contains no credentials', () => {
  const target = storage();
  for (let index = 0; index < GLPI_UNCERTAIN_MAX_REQUESTS + 2; index += 1) {
    savePendingGlpiRequest(payload(`${String(index + 1).padStart(8, '0')}-1111-1111-1111-111111111111`), target);
  }
  const saved = JSON.parse(target.values.get(GLPI_UNCERTAIN_STORAGE_KEY));
  assert.equal(saved.requests.length, GLPI_UNCERTAIN_MAX_REQUESTS);
  assert.equal(JSON.stringify(saved).includes('token'), false);
  assert.equal(JSON.stringify(saved).includes('password'), false);
});

test('member namespaces never expose one account draft to another account', () => {
  const target = storage();
  const alice = payload('33333333-3333-3333-3333-333333333333', 'Alice private description');
  savePendingGlpiRequest(alice, target, 'alice-member');
  assert.equal(readPendingGlpiRequest('', '', target, 'bob-member'), null);
  assert.equal(target.values.has(glpiUncertainStorageKey('bob-member')), false);
  assert.deepEqual(readPendingGlpiRequest('', '', target, 'alice-member')?.payload, alice);
});

test('quota, unavailable and corrupt storage fail closed instead of silently discarding identity', () => {
  const quota = { getItem: () => null, setItem: () => { throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); }, removeItem: () => {} };
  assert.deepEqual(savePendingGlpiRequest(payload('44444444-4444-4444-4444-444444444444'), quota), { ok: false, reason: 'quota' });
  assert.deepEqual(savePendingGlpiRequest(payload('55555555-5555-5555-5555-555555555555'), null), { ok: false, reason: 'unavailable' });
  const corrupt = storage();
  corrupt.values.set(GLPI_UNCERTAIN_STORAGE_KEY, '{"version":2,"requests":[{"payload":"not-a-payload"}]}');
  assert.equal(getGlpiDraftStorageStatus('', corrupt), 'corrupt');
  assert.deepEqual(savePendingGlpiRequest(payload('66666666-6666-6666-6666-666666666666'), corrupt), { ok: false, reason: 'corrupt' });
  assert.equal(readPendingGlpiRequest('', '', corrupt), null);
});
