import { createServer } from 'node:http';
import { generateKeyPairSync, randomUUID, createHash, sign } from 'node:crypto';
export const tenant = '11111111-1111-4111-8111-111111111111';
export const clientId = '22222222-2222-4222-8222-222222222222';
export const aliceOid = '33333333-3333-4333-8333-333333333333';
export const bobOid = '44444444-4444-4444-8444-444444444444';
export const issuer = `https://login.microsoftonline.com/${tenant}/v2.0`;
export async function mockMicrosoft(port = 8791) {
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const wrong = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...key.publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
  const codes = new Map(), calls = [];
  const metadata = { issuer, authorization_endpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    token_endpoint: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, jwks_uri: `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`,
    response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_post'] };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    calls.push({ path: url.pathname, method: req.method });
    function json(body, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }
    if (url.pathname.endsWith('/.well-known/openid-configuration')) return json(metadata);
    if (url.pathname.endsWith('/keys')) return json({ keys: [jwk] });
    if (url.pathname.endsWith('/authorize')) {
      const params = url.searchParams;
      if (params.get('client_id') !== clientId || params.get('response_type') !== 'code' || params.get('code_challenge_method') !== 'S256' || params.get('scope') !== 'openid profile email') return json({ error: 'bad authorize parameters' }, 400);
      const mode = params.get('test_mode') || 'ok', redirect = new URL(params.get('redirect_uri'));
      redirect.searchParams.set('state', params.get('state'));
      if (mode === 'cancelled') redirect.searchParams.set('error', 'access_denied');
      else { const code = randomUUID(); codes.set(code, { params, mode }); redirect.searchParams.set('code', code); }
      res.writeHead(302, { Location: redirect.href }); return res.end();
    }
    if (url.pathname.endsWith('/token') && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const params = new URLSearchParams(body), record = codes.get(params.get('code')); codes.delete(params.get('code'));
      if (!record || params.get('client_id') !== clientId || params.get('client_secret') !== 'test-only-secret' || params.get('grant_type') !== 'authorization_code' || params.get('redirect_uri') !== record.params.get('redirect_uri') || createHash('sha256').update(params.get('code_verifier') || '').digest('base64url') !== record.params.get('code_challenge')) return json({ error: 'invalid_grant' }, 400);
      if (record.mode === 'offline') return json({ error: 'temporarily_unavailable' }, 503);
      const now = Math.floor(Date.now() / 1000);
      const claims = { iss: issuer, aud: clientId, sub: 'not-used-as-member', tid: tenant, oid: aliceOid,
        iat: now, exp: now + 3600, nonce: record.params.get('nonce'), email: 'changed-name@elsewhere.test', name: 'Untrusted display name' };
      const mode = record.mode;
      if (mode === 'bob') claims.oid = bobOid;
      if (mode === 'unknown') { claims.oid = '55555555-5555-4555-8555-555555555555'; claims.email = 'alice@entra.test'; }
      if (mode === 'tenant') claims.tid = '66666666-6666-4666-8666-666666666666';
      if (mode === 'issuer') claims.iss = issuer.replace(tenant, '66666666-6666-4666-8666-666666666666');
      if (mode === 'audience') claims.aud = '66666666-6666-4666-8666-666666666666';
      if (mode === 'nonce') claims.nonce = 'incorrect-nonce';
      if (mode === 'expired') claims.exp = now - 3600;
      if (mode === 'missing-oid') delete claims.oid;
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url'), input = header + '.' + payload;
      const idToken = input + '.' + sign('RSA-SHA256', Buffer.from(input), mode === 'signature' ? wrong.privateKey : key.privateKey).toString('base64url');
      return json({ access_token: 'never-store-this-token', token_type: 'Bearer', expires_in: 3600, ...(mode !== 'missing-id-token' ? { id_token: idToken } : {}) });
    }
    json({ error: 'not_found' }, 404);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, calls, codes };
}
