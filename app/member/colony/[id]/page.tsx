// app/member/colony/[id]/page.tsx — one colony room for a member
// (HUMAN-WINDOW-001 commit 4). The id is passed straight to the API, which resolves
// membership and refuses a personal or archived room with an indistinguishable 404.
// This page never reads the database.
import { redirect } from 'next/navigation';
import { createReadOnlySessionClient } from '@/lib/supabase/server';
import MemberChat from '../../MemberChat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function MemberColonyRoomPage({ params }: { params: { id: string } }) {
  const supabase = createReadOnlySessionClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) redirect('/member/login');

  return (
    <MemberChat
      endpoint={`/api/member/colony/${encodeURIComponent(params.id)}`}
      backHref="/member"
      backLabel="Back to your dashboard"
    />
  );
}
