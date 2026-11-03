// app/auth/member/confirm/route.ts
// ----------------------------------------------------------------------------
// THE HIVE — POST: the "Sign me in" button (MEMBER-001 item 1).
//
// This is the ONLY place the emailed link's token is consumed. The page at
// /member/login/confirm never touches it, so a mail scanner that opens the link
// spends nothing. There is deliberately no GET here.
//
// 303, so the browser follows with a GET rather than re-posting the spent token.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { createSessionClient } from '@/lib/supabase/server';
import { sameOrigin } from '@/lib/member-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const origin = req.nextUrl.origin;
  const refused = NextResponse.redirect(`${origin}/member/login?error=link_expired`, 303);
  if (!sameOrigin(req)) return refused;

  const form = await req.formData().catch(() => null);
  const token = form?.get('token');
  if (typeof token !== 'string' || !token) return refused;

  // type 'email' covers a token issued as magiclink and one issued as signup, which
  // is what generateLink returns for a member who has never signed in before.
  const { error } = await createSessionClient().auth.verifyOtp({ token_hash: token, type: 'email' });
  if (error) {
    console.error('member auth: link refused', error.message);
    return refused;
  }
  return NextResponse.redirect(`${origin}/member`, 303);
}
