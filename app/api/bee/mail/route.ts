// app/api/bee/mail/route.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — GET /api/bee/mail?cursor=<ISO timestamp> (XI-1 v0.4 §3;
// ANTENNA-006 item 7).
//
// Reads new messages in the bee's OWN colony inbox, resolved from the token. At
// most ten per read, oldest first, never the bee's own sent mail; bodies pass the
// credential patterns (replaced, not refused) and the 32 KB cap; attachments are
// names and sizes only. The work is mailRead in lib/antenna/mail.ts.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { verifyBeeToken } from '@/lib/antenna/auth';
import { clientIp } from '@/lib/antenna/db';
import { beeErrorResponse } from '@/lib/antenna/errors';
import { liveMailDeps, mailRead } from '@/lib/antenna/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// FIND-POLL-CACHE — the same fetch posture as every other bee route.
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const bee = await verifyBeeToken(req);
    const ip = clientIp(req);
    const result = await mailRead(
      { agentId: bee.agent_id, tokenId: bee.token_row.token_id, ip },
      req.nextUrl.searchParams,
      liveMailDeps(),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    return beeErrorResponse(err);
  }
}
