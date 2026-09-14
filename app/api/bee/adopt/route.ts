// app/api/bee/adopt/route.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — POST /api/bee/adopt (XI-1 v0.2.2 §10.2, §6.12).
//
// Records that a bee adopted the L1 soul layer. That is ALL it does.
//
// §10.2: adoption is the bee's own act. The bee ran `antenna adopt --l1`, which
// appended one line to its own AGENTS.md on its own machine by its own hand. The
// Hive never appends that line, never parses a "yes", and never evaluates content.
// This endpoint writes one audit row after the fact; it cannot cause an adoption
// and there is nothing here to decline.
//
// Previously the client announced adoption by posting "adopted L1" into its
// chamber. That conflated a record with a message: the chamber is for things the
// bee has to say, and an audit row is not one of them.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { verifyBeeToken } from '@/lib/antenna/auth';
import { clientIp } from '@/lib/antenna/db';
import { BeeError, beeErrorResponse } from '@/lib/antenna/errors';
import { writeBeeEvent } from '@/lib/antenna/events';
import { enforceRateLimit } from '@/lib/antenna/rate-limit';
import { adoptSchema, validateClosed, validationStatus } from '@/lib/antenna/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AdoptBody {
  client_version: string;
}

export async function POST(req: NextRequest) {
  try {
    const bee = await verifyBeeToken(req);
    const ip = clientIp(req);
    await enforceRateLimit({ scope: 'adopt', tokenId: bee.token_row.token_id, agentId: bee.agent_id, ip });

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new BeeError(400, 'invalid_json', 'body must be valid JSON');
    }

    const parsed = validateClosed<AdoptBody>(raw, adoptSchema);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.code, message: parsed.message }, { status: validationStatus(parsed) });
    }

    await writeBeeEvent({
      event: 'adoption_l1',
      agentId: bee.agent_id,
      ip,
      detail: { client_version: parsed.value.client_version, layer: 'L1' },
    });

    return NextResponse.json({ recorded: true }, { status: 202 });
  } catch (err) {
    return beeErrorResponse(err);
  }
}
