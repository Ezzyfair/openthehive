// app/api/bee/rooms/route.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — GET /api/bee/rooms?cursor=<ISO timestamp> (XI-1 v0.4 §4,
// §7.15; ANTENNA-007 item 4).
//
// room.poll: the bee's derived room list, today's general choices and choice, and
// the posts in those rooms newer than the cursor — never the bee's own, only what
// the chamber read would deliver, at most twenty, oldest first, credentials
// replaced. The list comes from the token's agent and the clock; no query field
// can widen it. The work is roomPoll in lib/antenna/rooms.ts.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { verifyBeeToken } from '@/lib/antenna/auth';
import { clientIp } from '@/lib/antenna/db';
import { beeErrorResponse } from '@/lib/antenna/errors';
import { liveRoomsDeps, roomPoll } from '@/lib/antenna/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// FIND-POLL-CACHE — the same fetch posture as every other bee route.
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const bee = await verifyBeeToken(req);
    const ip = clientIp(req);
    const result = await roomPoll(
      { agentId: bee.agent_id, tokenId: bee.token_row.token_id, ip },
      req.nextUrl.searchParams,
      liveRoomsDeps(),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    return beeErrorResponse(err);
  }
}
