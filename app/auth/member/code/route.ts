// app/auth/member/code/route.ts
// ----------------------------------------------------------------------------
// THE HIVE — POST: sign in with the code from the email (MEMBER-001 item 2).
//
// The cross-device, scanner-proof path: no link is opened, so nothing can open it
// first, and no browser state is needed. Same token as the link: spending one
// spends the other.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { clientIp } from '@/lib/antenna/db';
import { BeeError } from '@/lib/antenna/errors';
import { enforceRateLimit } from '@/lib/antenna/rate-limit';
import { emailBucket, normalizeCode, normalizeEmail, sameOrigin } from '@/lib/member-auth';
import { memberErrorResponse, memberJson } from '@/lib/member-reads';
import { createSessionClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const REFUSED = 'That code did not work. Check it, or send a new one.';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    if (!sameOrigin(req)) throw new BeeError(403, 'bad_origin', 'request refused');
    const body = await req.json().catch(() => null);
    const email = normalizeEmail(body?.email);
    const code = normalizeCode(body?.code);
    if (!email || !code) throw new BeeError(400, 'invalid_code', REFUSED);

    await enforceRateLimit({ scope: 'signin_code', tokenId: emailBucket(email), ip: clientIp(req) });

    const { error } = await createSessionClient().auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) {
      console.error('member auth: code refused', error.message);
      throw new BeeError(400, 'invalid_code', REFUSED);
    }
    return memberJson({ ok: true });
  } catch (err) {
    return memberErrorResponse(err);
  }
}
