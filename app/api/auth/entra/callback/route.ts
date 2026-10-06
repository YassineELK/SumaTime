import { cookies } from 'next/headers';
import { AuthError, createSession } from '@/lib/auth';
import { consumeEntraFlow, ENTRA_FLOW_COOKIE, finishEntra, flowCookie, requireEntra } from '@/lib/entra';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const headers = new Headers({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  headers.append('Set-Cookie', `${ENTRA_FLOW_COOKIE}=; HttpOnly; SameSite=Lax; Path=/api/auth/entra; Max-Age=0`);
  let error = 'invalid';
  try {
    const config = requireEntra();
    headers.set('Set-Cookie', flowCookie('', config, true));
    const url = new URL(config.redirectUri);
    url.search = new URL(request.url).search;
    const flow = consumeEntraFlow(url, (await cookies()).get(ENTRA_FLOW_COOKIE)?.value);
    if (url.searchParams.has('error')) { error = url.searchParams.get('error') === 'access_denied' ? 'cancelled' : 'unavailable'; throw new Error('Provider refused authentication'); }
    const identity = await finishEntra(config, url, flow);
    headers.append('Set-Cookie', createSession(identity.memberId, request, identity));
    headers.set('Location', config.origin + '/');
    return new Response(null, { status: 303, headers });
  } catch (cause) {
    if (cause instanceof AuthError && cause.status === 403) error = 'denied';
    else if (cause instanceof AuthError && cause.status === 503) error = 'unavailable';
    // Never log authorization codes, provider messages, credentials or tokens.
    headers.set('Location', '/login?entra_error=' + error);
    return new Response(null, { status: 303, headers });
  }
}
