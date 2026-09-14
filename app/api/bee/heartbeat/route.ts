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

/** The one flag heartbeat treats as a state change rather than a report (§10.2). */
const ADOPTION_FLAG = 'adoption_l1';

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

    // §10.2, ruling of Sept 14 — adoption is a heartbeat FLAG, not a sixth verb.
    // The bee token still grants exactly the five operations §5 names, and
    // hive/SKILL.md's list stays true as written.
    //
    // The bee has already appended the L1 line on its own machine by its own hand.
    // This records that it happened, once. Idempotent: adoption is a state, not an
    // event stream, and a bee that re-sends the flag (a restarted client replaying
    // its flags, say) must not accumulate rows that would read as repeated
    // adoptions in Mission Control.
    const adopted = body.flags.includes(ADOPTION_FLAG);
    if (adopted) {
      const { count, error: countErr } = await admin
        .from('bee_client_events')
        .select('id', { count: 'exact', head: true })
        .eq('agent_id', bee.agent_id)
        .eq('event', 'adoption_l1');

      if (countErr) {
        // Audit reads must not fail a heartbeat; the bee is alive either way.
        console.error('antenna: adoption_l1 lookup failed', countErr.message);
      } else if ((count ?? 0) === 0) {
        await writeBeeEvent({
          event: 'adoption_l1',
          agentId: bee.agent_id,
          ip,
          detail: { client_version: body.client_version, layer: 'L1', via: 'heartbeat_flag' },
        });
      }
    }

    // §11 — nothing is only in the log. Every other flag keeps its existing
    // heartbeat_flag row; adoption_l1 is dropped from that list so the same fact
    // is not recorded twice under two different event types.
    const otherFlags = body.flags.filter((f) => f !== ADOPTION_FLAG);
    if (otherFlags.length > 0) {
      await writeBeeEvent({
        event: 'heartbeat_flag',
        agentId: bee.agent_id,
        ip,
        detail: {
          flags: otherFlags,
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
