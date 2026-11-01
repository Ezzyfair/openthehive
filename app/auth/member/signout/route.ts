// app/auth/member/signout/route.ts — POST: the "Sign out" link in /member's footer
// (MEMBER-001 item 3). This device only: a human signed in on a phone and a laptop
// signs out of the one in their hand. A POST, so an image tag cannot sign anyone out.
import { NextRequest, NextResponse } from 'next/server';
import { sameOrigin } from '@/lib/member-auth';
import { createSessionClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (sameOrigin(req)) await createSessionClient().auth.signOut({ scope: 'local' });
  return NextResponse.redirect(`${req.nextUrl.origin}/member/login`, 303);
}
