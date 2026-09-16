import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword, validPassword } from '../lib/password.ts';
import { escapeFilter, authenticateLdap } from '../lib/ldap.ts';
test('passwords are salted and validated without storing plaintext', async () => {
  const password = 'Une phrase privée pour tester !';
  const first = await hashPassword(password), second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.ok(!first.includes(password));
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('mauvais mot de passe', first), false);
  assert.equal(validPassword('court'), false);
  assert.equal(validPassword('a'.repeat(129)), false);
});
test('LDAP filter values cannot change the configured search filter', () => {
  assert.equal(escapeFilter('user*)(uid=*)\\\0'), 'user\\2a\\29\\28uid=\\2a\\29\\5c\\00');
});
test('LDAP refuses plaintext credentials even when enabled', async () => {
  const original = { ...process.env };
  process.env.LDAP_ENABLED = 'true'; process.env.LDAP_URL = 'ldap://example.test'; process.env.LDAP_STARTTLS = 'false';
  try { await assert.rejects(authenticateLdap('user', 'test'), /requires LDAPS/); }
  finally { process.env = original; }
});
test('directory login upgrades TLS, searches an escaped identifier, binds as the unique user, and unbinds', async () => {
  const original = { ...process.env }, calls = [];
  Object.assign(process.env, { LDAP_ENABLED: 'true', LDAP_URL: 'ldap://directory.test', LDAP_STARTTLS: 'true', LDAP_BASE_DN: 'dc=test', LDAP_BIND_DN: 'cn=service', LDAP_BIND_PASSWORD: 'service-secret', LDAP_USER_FILTER: '(uid={{username}})' });
  delete process.env.LDAP_CA_FILE;
  const client = {
    async startTLS(options) { calls.push('tls'); assert.equal(options.rejectUnauthorized, true); },
    async bind(dn, password) { calls.push([dn, password]); },
    async search(base, options) { calls.push('search'); assert.equal(base, 'dc=test'); assert.equal(options.filter, '(uid=user\\2a)'); assert.equal(options.sizeLimit, 2); return { searchEntries: [{ dn: 'uid=user,dc=test' }] }; },
    async unbind() { calls.push('unbind'); },
  };
  try {
    assert.equal(await authenticateLdap('user*', 'user-secret', () => client), true);
    assert.deepEqual(calls, ['tls', ['cn=service','service-secret'], 'search', ['uid=user,dc=test','user-secret'], 'unbind']);
    client.search = async () => ({ searchEntries: [{ dn:'a' }, { dn:'b' }] });
    assert.equal(await authenticateLdap('user', 'secret', () => client), false);
    client.search = async () => ({ searchEntries: [{ dn:'a' }] });
    client.bind = async dn => { if (dn === 'a') throw { code: 49 }; };
    assert.equal(await authenticateLdap('user', 'wrong', () => client), false);
  } finally { process.env = original; }
});
