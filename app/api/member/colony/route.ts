// app/api/member/colony/route.ts
// ----------------------------------------------------------------------------
// THE HIVE — GET /api/member/colony (HUMAN-WINDOW-001 commit 2).
//
// The colony room list. Audience 3 of the four (Francis, Sept 25): every signed-in
// member reads the colony rooms. Membership is the whole gate — there is no
// per-room ownership, because a colony room belongs to the colony.
//
// type='hive' AND status='active'. PERSONAL CHAMBERS CANNOT APPEAR HERE, not even
// as a title: the filter is an allow-list on type, so a chamber is excluded by
// construction rather than by a rule that could be forgotten (C5, option b —
// personal chambers are never listed, and non-showcase rooms are shown locked to
// anonymous visitors by the PUBLIC surface, which is commit 3's business, not this
// route's; this route answers members only).
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { antennaAdmin } from '@/lib/antenna/db';
import { BeeError, beeErrorResponse } from '@/lib/antenna/errors';
import { resolveMemberSession } from '@/lib/antenna/member';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// FIND-POLL-CACHE — see app/api/member/chamber/route.ts. antennaAdmin() carries the
// request-level cache: 'no-store'; these two make the route's posture explicit.
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    await resolveMemberSession(req);
    const admin = antennaAdmin();

    const { data, error } = await admin
      .from('honeycombs')
      .select('id, title, description, message_count, last_activity_at')
      .eq('type', 'hive')
      .eq('status', 'active')
      .order('last_activity_at', { ascending: false });

    if (error) {
      console.error('member colony: room list failed', error.message);
      throw new BeeError(500, 'internal_error', 'rooms could not be read');
    }

    return NextResponse.json({ rooms: data ?? [] });
  } catch (err) {
    return beeErrorResponse(err);
  }
}
