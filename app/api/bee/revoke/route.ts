// app/api/bee/revoke/route.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — POST /api/bee/revoke (XI-1 v0.2.2 §5, §5.3, §6.12).
//
// Self-revocation, and only self: the row revoked is the one the presented token
// resolved to (§5.2 — bee tokens revoke themselves; a member revoking someone
// else's bee is the member namespace, not here). Body is {} and nothing else.
//
// After this returns, the verifier refuses the same token on its next use, so
// the client is expected to stop and overwrite hive.json's token field with
// "revoked" (§14 ruling 8, N3/N4).
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { verifyBeeToken } from '@/lib/antenna/auth';
import { antennaAdmin, clientIp } from '@/lib/antenna/db';
import { BeeError, beeErrorResponse } from '@/lib/antenna/errors';
import { writeBeeEvent } from '@/lib/antenna/events';
import { enforceRateLimit } from '@/lib/antenna/rate-limit';
import { revokeSchema, validateClosed, validationStatus } from '@/lib/antenna/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const bee = await verifyBeeToken(req);
    const ip = clientIp(req);
    await enforceRateLimit({ scope: 'revoke', tokenId: bee.token_row.token_id, agentId: bee.agent_id, ip });

    // Body is optional on the wire but must be {} when sent.
    const text = await req.text();
    if (text.trim().length > 0) {
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new BeeError(400, 'invalid_json', 'body must be valid JSON');
      }
      const parsed = validateClosed(raw, revokeSchema);
      if (!parsed.ok) {
        return NextResponse.json({ error: parsed.code, message: parsed.message }, { status: validationStatus(parsed) });
      }
    }

    // Conditional on still being live, so a double revoke cannot rewrite the
    // original revoked_at or relabel a 'superseded' row as 'self'.
    const { error } = await antennaAdmin()
      .from('bee_tokens')
      .update({ revoked_at: new Date().toISOString(), revoked_by: 'self' })
      .eq('id', bee.token_row.id)
      .is('revoked_at', null);

    if (error) {
      console.error('antenna: self-revoke failed', error.message);
      throw new BeeError(500, 'internal_error', 'revoke failed');
    }

    await writeBeeEvent({
      event: 'revoke',
      agentId: bee.agent_id,
      ip,
      detail: { revoked_by: 'self', bee_token_id: bee.token_row.id },
    });

    return NextResponse.json({ revoked: true }, { status: 200 });
  } catch (err) {
    return beeErrorResponse(err);
  }
}
