// app/honeycombs/page.tsx
// ----------------------------------------------------------------------------
// The room index. C5b (Francis, Sept 26): an anonymous visitor sees the two showcase
// rooms in full plus the TITLES of other active hive rooms, shown locked; a member sees
// the full list; personal chambers are listed for nobody.
//
// The list is read with the service role, as before, so it survives the commit-5 policy
// drop. What changed is that the ROWS ARE NOW FILTERED BY AUDIENCE before they reach the
// client — previously every active room of every type went to an unauthenticated
// visitor, personal chambers included.
//
// The audience decision is lib/chat-view.ts:listRooms, a pure function, because this
// repo has no component-render harness to test a page through.
// ----------------------------------------------------------------------------
import { antennaAdmin } from '@/lib/antenna/db';
import { resolveMemberSession } from '@/lib/antenna/member';
import HoneycombsClient from '@/components/HoneycombsClient';
import { listRooms, type RoomRow } from '@/lib/chat-view';
import { SHOWCASE_IDS } from '@/lib/showcase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

/**
 * A MEMBER IS A RESOLVED members ROW, not merely a signed-in Supabase identity.
 *
 * resolveMemberSession is the same check every /api/member/* route makes — auth user →
 * email → members.id — so the index and the routes agree by construction rather than by
 * two similar-looking conditions. It throws BeeError(401) with no session and
 * BeeError(403) when the identity has no membership; both mean "not a member here", and
 * both land in the same catch.
 *
 * FAILS CLOSED to the anonymous view on ANY throw, including an unreachable database.
 * Being wrong that way costs a member a locked title they could have opened, and one
 * reload fixes it; being wrong the other way shows a stranger the colony's rooms.
 */
async function isMember(): Promise<boolean> {
  try {
    await resolveMemberSession();
    return true;
  } catch {
    return false;
  }
}

export default async function HoneycombsPage() {
  const [member, roomsRes] = await Promise.all([
    isMember(),
    antennaAdmin()
      .from('honeycombs')
      .select('id, title, description, type, message_count, last_activity_at, status')
      .eq('status', 'active')
      .order('last_activity_at', { ascending: false }),
  ]);

  // The error is not discarded. A failed read renders an empty list today, which is
  // honest for an index — but it is logged rather than swallowed, and the row count is
  // the only thing the client is told.
  if (roomsRes.error) {
    console.error('honeycombs index: room read failed', roomsRes.error.message);
  }

  const rooms = listRooms((roomsRes.data ?? []) as RoomRow[], {
    isMember: member,
    showcaseIds: SHOWCASE_IDS,
  });

  return <HoneycombsClient initialHoneycombs={rooms} />;
}
