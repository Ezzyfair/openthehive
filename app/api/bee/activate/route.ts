// app/api/bee/activate/route.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — POST /api/bee/activate (XI-1 v0.2.2 §2, §5.3, §6.5).
//
// The one bee endpoint that does NOT call verifyBeeToken: it is where the bee
// token comes from. The caller holds a one-time install token instead, and
// scripts/check-bee-routes.mjs exempts this file by name for that reason.
//
// Order: rate limit by IP (no token exists yet) -> closed schema -> one atomic
// DB function. antenna_activate() consumes the install token, supersedes any
// live token for the agent, inserts the new one, and writes the audit row, all
// in one transaction (§6.5).
//   P0410 -> 410 (consumed, expired, revoked, unknown)
//   23505 -> 409 (a concurrent activation won; this one rolled back cleanly)
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { hashInstallToken, mintBeeToken, JOIN_TOKEN_PREFIX } from '@/lib/antenna/auth';
import { deriveInbox, nextPollSeconds } from '@/lib/antenna/chamber';
import { antennaAdmin, clientIp } from '@/lib/antenna/db';
import { BeeError, beeErrorResponse, mapActivationPgError } from '@/lib/antenna/errors';
import { enforceRateLimit } from '@/lib/antenna/rate-limit';
import { activateSchema, validateClosed, validationStatus } from '@/lib/antenna/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ActivateBody {
  install_token: string;
  client_version: string;
  mode: 'command' | 'openclaw' | 'files';
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);
  try {
    await enforceRateLimit({ scope: 'activate', ip });

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new BeeError(400, 'invalid_json', 'body must be valid JSON');
    }

    const parsed = validateClosed<ActivateBody>(raw, activateSchema);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.code, message: parsed.message }, { status: validationStatus(parsed) });
    }
    const body = parsed.value;

    // An install token is the only credential this endpoint accepts. A bee token
    // or a legacy agent_api_key presented here is rejected before any lookup.
    if (!body.install_token.startsWith(JOIN_TOKEN_PREFIX)) {
      throw new BeeError(410, 'install_token_invalid', 'install token unknown, consumed, expired, or revoked');
    }

    // token_id and secret are generated together; the plaintext never leaves this
    // response, and the function below persists only token_id / salt / token_hash.
    const minted = mintBeeToken();

    const { data, error } = await antennaAdmin().rpc('antenna_activate', {
      p_install_hash: hashInstallToken(body.install_token),
      p_token_id: minted.token_id,
      p_salt: minted.salt,
      p_token_hash: minted.token_hash,
      p_ip: ip,
      p_client_version: body.client_version,
    });

    if (error) {
      const mapped = mapActivationPgError(error as { code?: string | null });
      if (mapped) throw mapped;
      console.error('antenna: antenna_activate failed', error.message);
      throw new BeeError(500, 'internal_error', 'activation failed');
    }

    const row = Array.isArray(data) ? data[0] : data;
    const agentId: string | undefined = row?.out_agent_id;
    if (!agentId) {
      console.error('antenna: antenna_activate returned no agent id');
      throw new BeeError(500, 'internal_error', 'activation failed');
    }

    // Hard requirement, not a nicety (NIK-ANTENNA-004b). The token is already
    // minted and the install token already consumed at this point, so a missing
    // agent means the row the FK pointed at is gone — a broken activation. It
    // fails loudly rather than handing the bee a working token under the name
    // 'Bee' and an inbox derived from it, which is an identity the colony would
    // then have to live with.
    const { data: agent, error: agentErr } = await antennaAdmin()
      .from('agents')
      .select('id, name, status')
      .eq('id', agentId)
      .maybeSingle();

    if (agentErr) {
      console.error('antenna: post-activation agent lookup failed', agentErr.message);
      throw new BeeError(500, 'internal_error', 'activation completed but the agent could not be read');
    }
    const beeName = (agent as { name?: string } | null)?.name;
    if (!beeName) {
      console.error('antenna: activation produced no readable agent', agentId);
      throw new BeeError(500, 'internal_error', 'activation completed but the agent could not be read');
    }

    return NextResponse.json(
      {
        bee_token: minted.plaintext,
        agent_id: agentId,
        bee_name: beeName,
        inbox: deriveInbox(beeName),
        next_poll_seconds: nextPollSeconds((agent as { status?: string } | null)?.status),
        // FIND-CURSOR-0 — a bee starts from its activation moment, not from the
        // beginning of time. The client used to write cursor 0, so a bee joining a
        // chamber that already held a coach's welcome, a census and a week of staff
        // posts replayed all of it into the agent's runtime on its first poll.
        //
        // The server supplies it rather than the client, so every bee agrees with
        // the colony's clock instead of its own machine's. The client falls back to
        // its local now() only if this field is missing (an older route).
        cursor: Date.now(),
      },
      { status: 200 },
    );
  } catch (err) {
    return beeErrorResponse(err);
  }
}
