// app/api/member/bees/[bee_token_id]/revoke/route.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — POST /api/member/bees/<bee_token_id>/revoke (§5.2, §6.12).
//
// A member kills their own bee's token. The id in the path is resolved to its
// agent and that agent is checked against the session BEFORE anything is written
// (§5.2). A token belonging to someone else answers 404, not 403 — this endpoint
// does not confirm that another member's token id exists.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { antennaAdmin, clientIp } from '@/lib/antenna/db';
import { BeeError, beeErrorResponse } from '@/lib/antenna/errors';
import { writeBeeEvent } from '@/lib/antenna/events';
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

export async function POST(req: NextRequest, ctx: { params: { bee_token_id: string } }) {
  try {
    const session = await resolveMemberSession(req);
    const admin = antennaAdmin();

    const { data, error } = await admin
      .from('bee_tokens')
      .select('id, agent_id, revoked_at')
      .eq('id', ctx.params.bee_token_id)
      .maybeSingle();

    if (error) {
      console.error('antenna: bee token lookup failed', error.message);
      throw new BeeError(500, 'internal_error', 'lookup failed');
    }
    const row = data as { id: string; agent_id: string; revoked_at: string | null } | null;
    if (!row) throw new BeeError(404, 'not_found', 'no such bee token for this member');

    await assertOwnsAgent(session, row.agent_id);

    if (row.revoked_at !== null) {
      // Idempotent: already dead stays dead, with its original timestamp.
      return NextResponse.json({ revoked: true, already_revoked: true });
    }

    const { error: updErr } = await admin
      .from('bee_tokens')
      .update({ revoked_at: new Date().toISOString(), revoked_by: 'member' })
      .eq('id', row.id)
      .is('revoked_at', null);

    if (updErr) {
      console.error('antenna: member revoke failed', updErr.message);
      throw new BeeError(500, 'internal_error', 'revoke failed');
    }

    await writeBeeEvent({
      event: 'revoke',
      agentId: row.agent_id,
      ip: clientIp(req),
      detail: { revoked_by: 'member', bee_token_id: row.id, member_id: session.member_id },
    });

    return NextResponse.json({ revoked: true });
  } catch (err) {
    return beeErrorResponse(err);
  }
}
