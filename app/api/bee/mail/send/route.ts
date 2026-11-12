// app/api/bee/mail/send/route.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — POST /api/bee/mail/send (XI-1 v0.4 §3; ANTENNA-006 item 6).
//
// Sends one text-only message from the bee's OWN colony inbox. The sender is
// derived from the token, never from the body; the body names only recipients,
// a subject and the text. The recipient rule, the caps and the patterns live in
// lib/antenna/mail.ts (mailSend); every refusal there is 422 with a reason and a
// bee_mail row. No 403 on this route (§7.21).
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { verifyBeeToken } from '@/lib/antenna/auth';
import { clientIp } from '@/lib/antenna/db';
import { BeeError, beeErrorResponse } from '@/lib/antenna/errors';
import { liveMailDeps, mailSend } from '@/lib/antenna/mail';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// FIND-POLL-CACHE — the same fetch posture as every other bee route.
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const bee = await verifyBeeToken(req);
    const ip = clientIp(req);

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new BeeError(400, 'invalid_json', 'body must be valid JSON');
    }

    const result = await mailSend(
      { agentId: bee.agent_id, tokenId: bee.token_row.token_id, ip },
      raw,
      liveMailDeps(),
    );
    return NextResponse.json(result.body, { status: result.status });
  } catch (err) {
    return beeErrorResponse(err);
  }
}
