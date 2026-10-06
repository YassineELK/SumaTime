import { rateLimit } from '@/lib/auth';
import { requireEntra, startEntra } from '@/lib/entra';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const config = requireEntra();
    // An admin local account must exist before Microsoft can be used.
    const { sqlite } = await import('@/db/raw');
    if (!sqlite().prepare('SELECT 1 FROM accounts LIMIT 1').get()) throw new Error('Setup required');
    rateLimit('entra:start', 100, 60000);
    const result = await startEntra(config, new URL(request.url).searchParams.get('switch') === '1');
    return new Response(null, { status: 303, headers: { Location: result.url, 'Set-Cookie': result.cookie, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch {
    return new Response(null, { status: 303, headers: { Location: '/login?entra_error=unavailable', 'Cache-Control': 'no-store' } });
  }
}
