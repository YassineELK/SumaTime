import { getMember } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Workspace from './workspace';
export const dynamic = 'force-dynamic';
export default async function Home() {
  if (!await getMember()) redirect('/login');
  return <Workspace />;
}
