// app/member/page.tsx
// ----------------------------------------------------------------------------
// THE HIVE — the member dashboard (XI-1 v0.2.2 §2, §8, F11; §13 step 4).
//
// Server component: it does nothing but prove there is a session and hand off.
// Every piece of data on the page comes from /api/member/*, so the dashboard and
// any other client see exactly the same ownership checks — there is no second
// read path that could disagree with the API.
//
// §8: the run command lives HERE and only here. Email links to this page.
// ----------------------------------------------------------------------------
import { redirect } from 'next/navigation';
import { createReadOnlySessionClient } from '@/lib/supabase/server';
import MemberDashboard from './MemberDashboard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function MemberPage() {
  const supabase = createReadOnlySessionClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data?.user) redirect('/member/login');

  return <MemberDashboard email={data.user.email ?? ''} />;
}
