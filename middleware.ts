// middleware.ts
// ----------------------------------------------------------------------------
// THE HIVE — keeps a member signed in (MEMBER-001 item 3).
//
// Pages and member API routes read the session through createReadOnlySessionClient,
// which cannot write cookies. When the access token expired, that read still spent
// the refresh token and threw the new one away, so a session died at its first
// expiry however long the cookie lived. Middleware can write, so the refresh happens
// here, before anything else reads the session.
//
// Every visit also re-stamps the cookie, so the 90 days roll from the last visit.
//
// getSession here, not getUser: this only keeps the tokens fresh and makes no network
// call unless they expired. Identity is still decided by getUser() downstream
// (lib/antenna/member.ts). /member/login is the exception, because a redirect must not
// rest on a cookie nobody verified.
//
// The matcher never includes /api/bee/*: bees hold tokens, not sessions.
// ----------------------------------------------------------------------------
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { isSessionCookie, memberCookieOptions } from '@/lib/member-session';

export const config = { matcher: ['/member/:path*', '/api/member/:path*'] };

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return NextResponse.next();

  const written: { name: string; value: string; maxAge?: number }[] = [];
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => req.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
        for (const { name, value, options } of list) {
          req.cookies.set(name, value);
          written.push({ name, value, maxAge: options?.maxAge });
        }
      },
    },
  });

  const isLogin = req.nextUrl.pathname === '/member/login';
  let signedIn = false;
  try {
    if (isLogin) {
      const { data } = await supabase.auth.getUser();
      signedIn = Boolean(data?.user);
    } else {
      await supabase.auth.getSession();
    }
  } catch (err) {
    // A failed refresh must not take the page down; the page's own check decides.
    console.error('member session: refresh failed', err instanceof Error ? err.message : err);
  }

  // req.cookies.set above rewrote the request's Cookie header, so forwarding the headers
  // hands the refreshed session to this request's handler as well as to the browser.
  const res = signedIn
    ? NextResponse.redirect(new URL('/member', req.nextUrl.origin))
    : NextResponse.next({ request: { headers: new Headers(req.headers) } });

  const done = new Set(written.map((c) => c.name));
  for (const c of written) res.cookies.set(c.name, c.value, memberCookieOptions({ maxAge: c.maxAge }));
  for (const c of req.cookies.getAll()) {
    if (isSessionCookie(c.name) && !done.has(c.name)) res.cookies.set(c.name, c.value, memberCookieOptions());
  }
  return res;
}
