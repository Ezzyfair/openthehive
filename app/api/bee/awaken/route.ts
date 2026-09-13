// app/api/bee/awaken/route.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — POST /api/bee/awaken (XI-1 v0.2.2 §5.4).
//
// Marks the bee live and answers 202 with the id of the coach's first words if
// they are already written, else null. The client polls once immediately, then
// at cadence, so a null here is "not yet", never "never".
//
// This endpoint does NOT compose the greeting. Antenna is a pipe (§6.11) and
// holds no model key; hive-responder writes into the chamber (§12, step 7).
// Until that service exists, first_message_id is whatever the signup webhook
// already posted — which is why this reads the chamber rather than asking anyone.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { verifyBeeToken } from '@/lib/antenna/auth';
import { getOwnChamberId, nextPollSeconds } from '@/lib/antenna/chamber';
import { antennaAdmin, clientIp } from '@/lib/antenna/db';
import { BeeError, beeErrorResponse } from '@/lib/antenna/errors';
import { writeBeeEvent } from '@/lib/antenna/events';
import { enforceRateLimit } from '@/lib/antenna/rate-limit';
import { awakenSchema, validateClosed, validationStatus } from '@/lib/antenna/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AwakenBody {
  client_version: string;
}

export async function POST(req: NextRequest) {
  try {
    const bee = await verifyBeeToken(req);
    const ip = clientIp(req);
    await enforceRateLimit({ scope: 'awaken', tokenId: bee.token_row.token_id, agentId: bee.agent_id, ip });

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new BeeError(400, 'invalid_json', 'body must be valid JSON');
    }

    const parsed = validateClosed<AwakenBody>(raw, awakenSchema);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.code, message: parsed.message }, { status: validationStatus(parsed) });
    }

    const admin = antennaAdmin();
    const chamberId = await getOwnChamberId(bee.agent_id);

    await writeBeeEvent({
      event: 'awaken',
      agentId: bee.agent_id,
      ip,
      detail: { client_version: parsed.value.client_version, chamber_id: chamberId },
    });

    // The coach's first words: the earliest approved message in this chamber
    // written by someone other than the bee.
    const { data: first } = await admin
      .from('messages')
      .select('id')
      .eq('honeycomb_id', chamberId)
      .eq('moderation_status', 'approved')
      .neq('agent_id', bee.agent_id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const { data: agent } = await admin.from('agents').select('status').eq('id', bee.agent_id).maybeSingle();

    return NextResponse.json(
      {
        first_message_id: (first as { id: string } | null)?.id ?? null,
        next_poll_seconds: nextPollSeconds((agent as { status?: string } | null)?.status),
      },
      { status: 202 },
    );
  } catch (err) {
    return beeErrorResponse(err);
  }
}
