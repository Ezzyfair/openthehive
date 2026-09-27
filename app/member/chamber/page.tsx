// app/member/chamber/page.tsx — "Your bee's chamber" (HUMAN-WINDOW-001 commit 4).
// A session gate and a handoff, exactly like app/member/page.tsx: every byte of data
// comes from /api/member/chamber, so there is no second read path that could disagree
// with the API's ownership check.
import { redirect } from 'next/navigation';
import { createReadOnlySessionClient } from '@/lib/supabase/server';
import MemberChat from '../MemberChat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function MemberChamberPage() {
  const supabase = createReadOnlySessionClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) redirect('/member/login');

  return <MemberChat
      endpoint="/api/member/chamber"
      backHref="/member"
      backLabel="Back to your dashboard"
      lane="chamber"
    />;
}
