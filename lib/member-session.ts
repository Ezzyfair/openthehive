// lib/member-session.ts
// ----------------------------------------------------------------------------
// THE HIVE — the member session's cookie, in one place (MEMBER-001 item 3).
//
// Pure on purpose: middleware.ts and lib/supabase/server.ts both need these values
// and middleware must not pull in next/headers.
//
// WHY THIS IS APPLIED IN setAll AND NOT THROUGH cookieOptions. @supabase/ssr 0.4.1
// spreads cookieOptions and then forces its own maxAge back over it
// (dist/main/cookies.js, setCookieOptions), so a 90-day cookieOptions.maxAge is
// silently ignored.
// ----------------------------------------------------------------------------

/** The standard: a human who signed in on a phone stays signed in on that phone. */
export const MEMBER_SESSION_MAX_AGE = 60 * 60 * 24 * 90;

export const MEMBER_COOKIE_ATTRS = {
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
} as const;

/** The attributes for a session cookie. A library removal (maxAge 0) stays a removal. */
export function memberCookieOptions(options?: { maxAge?: number }) {
  return {
    ...MEMBER_COOKIE_ATTRS,
    maxAge: options?.maxAge === 0 ? 0 : MEMBER_SESSION_MAX_AGE,
  };
}

/** Supabase's session cookies: sb-<ref>-auth-token, chunked as .0, .1, … */
export function isSessionCookie(name: string): boolean {
  return /^sb-.+-auth-token(\.\d+)?$/.test(name);
}
