// app/api/member/bees/route.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — GET /api/member/bees (XI-1 v0.2.2 §5.2).
//
// Lists the member's bees and token status for the dashboard. Member session,
// NOT a bee token: this is the member namespace and no bee token is accepted here.
//
// Nothing sensitive is returned. token_id is the lookup half and is not a secret;
// token_hash and salt never leave the database.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { antennaAdmin } from '@/lib/antenna/db';
import { beeErrorResponse } from '@/lib/antenna/errors';
import { ownedAgentId, resolveMemberSession } from '@/lib/antenna/member';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const session = await resolveMemberSession(req);
    const agentId = await ownedAgentId(session);
    const admin = antennaAdmin();

    const { data: agent } = await admin
      .from('agents')
      .select('id, name, soul, soul_emoji, status')
      .eq('id', agentId)
      .maybeSingle();

    const { data: tokens } = await admin
      .from('bee_tokens')
      .select('id, token_id, created_at, last_used_at, revoked_at, revoked_by, client_version')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false });

    const { data: installs } = await admin
      .from('join_tokens')
      .select('id, expires_at, consumed_at, revoked_at, revoked_by, created_at')
      .eq('agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(10);

    const now = Date.now();
    return NextResponse.json({
      bees: [
        {
          agent: agent ?? null,
          tokens: (tokens ?? []).map((t: any) => ({
            bee_token_id: t.id,
            token_id: t.token_id,
            created_at: t.created_at,
            last_used_at: t.last_used_at,
            client_version: t.client_version,
            revoked_at: t.revoked_at,
            revoked_by: t.revoked_by,
            live: t.revoked_at === null,
          })),
          install_tokens: (installs ?? []).map((j: any) => ({
            join_token_id: j.id,
            created_at: j.created_at,
            expires_at: j.expires_at,
            consumed_at: j.consumed_at,
            revoked_at: j.revoked_at,
            revoked_by: j.revoked_by,
            usable:
              j.consumed_at === null && j.revoked_at === null && new Date(j.expires_at).getTime() > now,
          })),
        },
      ],
    });
  } catch (err) {
    return beeErrorResponse(err);
  }
}
