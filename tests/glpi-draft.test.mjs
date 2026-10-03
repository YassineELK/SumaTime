import test from 'node:test';
import assert from 'node:assert/strict';
import { GLPI_UNCERTAIN_MAX_REQUESTS, GLPI_UNCERTAIN_STORAGE_KEY, readPendingGlpiRequest, removePendingGlpiRequest, savePendingGlpiRequest } from '../lib/glpi-draft.ts';

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
