// app/api/bee/heartbeat/route.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — POST /api/bee/heartbeat (XI-1 v0.2.2 §4, §5.3, §11).
//
// Liveness, version, flags. Answers with the cadence hint the client honors and
// the latest client version — updates are NOTIFY-ONLY (§4): the client logs it
// and writes the human file, and never updates itself.
//
// §11: every flag the client raises becomes a heartbeat_flag event, which is
// what puts `unreachable` and `unsent_replies:<n>` in front of a human in
// Mission Control instead of leaving them in a log on the bee's machine.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { verifyBeeToken } from '@/lib/antenna/auth';
import { nextPollSeconds } from '@/lib/antenna/chamber';
import { antennaAdmin, clientIp } from '@/lib/antenna/db';
import { BeeError, beeErrorResponse } from '@/lib/antenna/errors';
import { writeBeeEvent } from '@/lib/antenna/events';
import { enforceRateLimit } from '@/lib/antenna/rate-limit';
import { heartbeatSchema, validateClosed, validationStatus } from '@/lib/antenna/schemas';
import { LATEST_CLIENT_VERSION } from '@/lib/antenna/version';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface HeartbeatBody {
  client_version: string;
  mode: string;
  poll_seconds: number;
  queue_depth: number;
  flags: string[];
}

export async function POST(req: NextRequest) {
  try {
    const bee = await verifyBeeToken(req);
    const ip = clientIp(req);
    await enforceRateLimit({ scope: 'heartbeat', tokenId: bee.token_row.token_id, agentId: bee.agent_id, ip });

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new BeeError(400, 'invalid_json', 'body must be valid JSON');
    }

    const parsed = validateClosed<HeartbeatBody>(raw, heartbeatSchema);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.code, message: parsed.message }, { status: validationStatus(parsed) });
    }
    const body = parsed.value;

    const admin = antennaAdmin();

    // The client_version the bee reports is recorded on its token row, so the
    // dashboard can show what is actually running rather than what was installed.
    if (body.client_version !== bee.token_row.client_version) {
      const { error } = await admin
        .from('bee_tokens')
        .update({ client_version: body.client_version })
        .eq('id', bee.token_row.id);
      if (error) console.error('antenna: client_version update failed', error.message);
    }

    // §11 — nothing is only in the log.
    if (body.flags.length > 0) {
      await writeBeeEvent({
        event: 'heartbeat_flag',
        agentId: bee.agent_id,
        ip,
        detail: {
          flags: body.flags,
          mode: body.mode,
          poll_seconds: body.poll_seconds,
          queue_depth: body.queue_depth,
          client_version: body.client_version,
        },
      });
    }

    const { data: agent } = await admin.from('agents').select('status').eq('id', bee.agent_id).maybeSingle();

    return NextResponse.json({
      latest_version: LATEST_CLIENT_VERSION,
      next_poll_seconds: nextPollSeconds((agent as { status?: string } | null)?.status),
    });
  } catch (err) {
    return beeErrorResponse(err);
  }
}
