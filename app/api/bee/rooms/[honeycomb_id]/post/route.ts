// app/api/bee/rooms/[honeycomb_id]/post/route.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — POST /api/bee/rooms/<honeycomb_id>/post (XI-1 v0.4 §4,
// §7.21; ANTENNA-007 item 6).
//
// room.post: one message in a room on the bee's derived list at this moment. A
// room off the list, a room that does not exist and a malformed id are one 404
// with no detail. Read-only, the day's limit and a credential are 422 with a
// reason. No 403 on this route (§7.21). The work is roomPost in
// lib/antenna/rooms.ts.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { verifyBeeToken } from '@/lib/antenna/auth';
import { clientIp } from '@/lib/antenna/db';
import { BeeError, beeErrorResponse } from '@/lib/antenna/errors';
import { liveRoomsDeps, roomPost } from '@/lib/antenna/rooms';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// FIND-POLL-CACHE — the same fetch posture as every other bee route.
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function POST(req: NextRequest, ctx: { params: { honeycomb_id: string } }) {
  try {
    const bee = await verifyBeeToken(req);
    const ip = clientIp(req);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new BeeError(400, 'invalid_json', 'body must be valid JSON');
    }

    const result = await roomPost(
      { agentId: bee.agent_id, tokenId: bee.token_row.token_id, ip },
      ctx.params.honeycomb_id,
      raw,
      liveRoomsDeps(),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    return beeErrorResponse(err);
  }
}
