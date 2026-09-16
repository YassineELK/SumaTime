import { cookies } from 'next/headers';
import { createHash, randomBytes } from 'node:crypto';
import { sqlite } from '@/db/raw';
import type { Member } from './types';
export const COOKIE = 'sumatoni_session';
export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export class AuthError extends Error { constructor(message: string, public status = 400) { super(message); } }
export function appOrigin(request: Request) {
  if (process.env.APP_URL) return new URL(process.env.APP_URL).origin;
  const url = new URL(request.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new AuthError('Configurez APP_URL sur le serveur.', 503);
  return url.origin;
}
export function checkOrigin(request: Request) {
  if (request.headers.get('origin') !== appOrigin(request)) throw new AuthError('Origine de la requête non autorisée.', 403);
}
export async function getMember() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  return (sqlite().prepare(`SELECT m.id,m.user_id,m.email,m.name,m.role,m.active,a.provider,a.must_change
    FROM sessions s JOIN members m ON m.id=s.member_id JOIN accounts a ON a.member_id=m.id
    WHERE s.token_hash=? AND s.expires>? AND m.active=1`).get(tokenHash(token), Date.now()) as Member | undefined) || null;
}
export function createSession(memberId: string, request: Request) {
  const token = randomBytes(32).toString('hex');
  sqlite().prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
  sqlite().prepare('INSERT INTO sessions VALUES (?,?,?)').run(tokenHash(token), memberId, Date.now() + 12 * 3600000);
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200${appOrigin(request).startsWith('https:') ? '; Secure' : ''}`;
}
export function rateLimit(key: string, max: number, duration: number) {
  const now = Date.now();
  sqlite().prepare('DELETE FROM login_limits WHERE until<=?').run(now);
  const result = sqlite().prepare(`INSERT INTO login_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts`).get(key, now + duration) as { attempts: number };
  if (result.attempts > max) throw new AuthError('Trop de tentatives. Patientez avant de réessayer.', 429);
}
