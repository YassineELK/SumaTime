/* eslint-disable @next/next/no-html-link-for-pages -- Recovery links deliberately reload the page to repeat server access checks. */
import { AuthError, getMember } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Workspace from './workspace';
import Brand from '@/components/brand';
export const dynamic = 'force-dynamic';
export default async function Home() {
  let member;
  try { member = await getMember(); }
  catch (error) {
    if (!(error instanceof AuthError) || error.status !== 503) throw error;
    return <div className="welcome"><div className="welcome-card">
      <div className="brand dark-brand"><Brand /></div>
      <h1>Votre accès est temporairement indisponible.</h1>
      <p>La vérification Microsoft ne répond pas pour le moment. Vos prestations et votre chronomètre sont conservés.</p>
      <a className="primary full" href="/">Réessayer</a>
      <a className="text-button microsoft-switch" href="/login">Utiliser un accès local</a>
    </div></div>;
  }
  if (!member) redirect('/login');
  return <Workspace />;
}
