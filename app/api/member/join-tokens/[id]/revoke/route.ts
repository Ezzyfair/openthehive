// app/api/member/join-tokens/[id]/revoke/route.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — POST /api/member/join-tokens/<id>/revoke (§5.2, F11).
//
// Kills an install token that has not been used yet. F11: install tokens were
// irrevocable in Draft 1; join_tokens.revoked_at plus this endpoint is the fix.
//
// A consumed token is NOT revoked here. Consumption already spent it, and the
// row is the audit trail of that activation — rewriting it would erase when the
// bee actually came online. Killing the resulting bee token is the other endpoint.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { antennaAdmin } from '@/lib/antenna/db';
import { BeeError, beeErrorResponse } from '@/lib/antenna/errors';
import { assertOwnsAgent, resolveMemberSession } from '@/lib/antenna/member';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// FIND-POLL-CACHE — 'force-dynamic' governs how the ROUTE is rendered and
// revalidated. It does not stop Next.js serving an individual fetch inside the
// handler from the Data Cache, which is what froze /poll at an already-seen
// cursor. These two make the route's own fetch policy explicit; the request-level
// cache: 'no-store' in the supabase clients is the layer that actually holds.
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const session = await resolveMemberSession(req);
    const admin = antennaAdmin();

    const { data, error } = await admin
      .from('join_tokens')
      .select('id, agent_id, consumed_at, revoked_at')
      .eq('id', ctx.params.id)
      .maybeSingle();

    if (error) {
      console.error('antenna: join token lookup failed', error.message);
      throw new BeeError(500, 'internal_error', 'lookup failed');
    }
    const row = data as { id: string; agent_id: string; consumed_at: string | null; revoked_at: string | null } | null;
    if (!row) throw new BeeError(404, 'not_found', 'no such install token for this member');

    await assertOwnsAgent(session, row.agent_id);

    if (row.consumed_at !== null) {
      throw new BeeError(409, 'already_consumed', 'this install token was already used; revoke the bee token instead');
    }
    if (row.revoked_at !== null) {
      return NextResponse.json({ revoked: true, already_revoked: true });
    }

    const { error: updErr } = await admin
      .from('join_tokens')
      .update({ revoked_at: new Date().toISOString(), revoked_by: 'member' })
      .eq('id', row.id)
      .is('consumed_at', null)
      .is('revoked_at', null);

    if (updErr) {
      console.error('antenna: install token revoke failed', updErr.message);
      throw new BeeError(500, 'internal_error', 'revoke failed');
    }

    return NextResponse.json({ revoked: true });
  } catch (err) {
    return beeErrorResponse(err);
  }
}
