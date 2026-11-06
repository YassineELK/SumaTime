import { getMember, checkOrigin, AuthError } from '@/lib/auth';
import { transaction } from '@/db/raw';
import { billingItems } from '@/lib/billing-selection';
import { markEntriesBilled } from '@/lib/bulk-billing';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const me = await getMember(); if (!me) throw new AuthError('Reconnectez-vous.', 401);
    if (me.must_change) throw new AuthError('Changez votre mot de passe provisoire.', 403);
    if (me.role !== 'admin') throw new AuthError('La facturation est réservée aux administrateurs.', 403);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new AuthError('Format invalide.');
    const raw = await request.text(); if (raw.length > 150000) throw new AuthError('Requête trop volumineuse.');
    let body; try { body=JSON.parse(raw); } catch { throw new AuthError('Requête invalide.'); }
    let items; try { items=billingItems(body?.items); } catch (error) { throw new AuthError((error as Error).message); }
    const count = transaction(db => markEntriesBilled(db,me.id,items,new Date().toISOString()));
    return json({ ok: true, count });
  } catch (error) { return json({ error: error instanceof AuthError ? error.message : 'Le marquage n’a pas pu être confirmé. Actualisez le relevé avant de réessayer.' }, error instanceof AuthError ? error.status : 503); }
}
