// app/api/member/join-tokens/issue/route.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — POST /api/member/join-tokens/issue (§2, §8, F11).
//
// The dashboard's "give me the run command" button. Mints a hive_join_ token with
// a 30-minute TTL, stores only its hash, and returns the plaintext ONCE. §8: the
// command lives on the dashboard and never in email.
//
// Issuing revokes any earlier unconsumed token for the same bee, so a member
// clicking twice does not leave two live install tokens in circulation.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { clientIp } from '@/lib/antenna/db';
import { beeErrorResponse } from '@/lib/antenna/errors';
import { INSTALL_TOKEN_TTL_MINUTES, issueInstallToken } from '@/lib/antenna/install-token';
import { ownedAgentId, resolveMemberSession } from '@/lib/antenna/member';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const session = await resolveMemberSession(req);
    const agentId = await ownedAgentId(session);
    const issued = await issueInstallToken(agentId, clientIp(req));

    return NextResponse.json(
      {
        install_token: issued.plaintext,
        join_token_id: issued.join_token_id,
        expires_at: issued.expires_at,
        ttl_minutes: INSTALL_TOKEN_TTL_MINUTES,
      },
      { status: 201 },
    );
  } catch (err) {
    return beeErrorResponse(err);
  }
}
