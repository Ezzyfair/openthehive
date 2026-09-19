// app/auth/callback/route.ts
// ----------------------------------------------------------------------------
// THE HIVE — magic-link landing. Supabase redirects here with a one-time `code`;
// this exchanges it for a cookie session and sends the member to the dashboard.
//
// `next` is validated as a same-origin relative path before it is used. An open
// redirect on the auth callback is how a magic link gets turned into a way of
// bouncing a freshly authenticated member somewhere else.
// ----------------------------------------------------------------------------
import { NextRequest, NextResponse } from 'next/server';
import { createSessionClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeNext(raw: string | null): string {
  if (!raw) return '/member';
  // Relative, single-slash, no scheme, no protocol-relative //host.
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/member';
  return raw;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const next = safeNext(req.nextUrl.searchParams.get('next'));
  const origin = req.nextUrl.origin;

  if (!code) {
    return NextResponse.redirect(`${origin}/member/login?error=missing_code`);
  }

  const supabase = createSessionClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error('member auth: code exchange failed', error.message);
    return NextResponse.redirect(`${origin}/member/login?error=link_expired`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
