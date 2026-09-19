// lib/supabase/server.ts
// ----------------------------------------------------------------------------
// THE HIVE — the member-session Supabase client (Supabase Auth, magic link).
//
// This is the MEMBER lane and it is cookie-based. It is not the service role and
// it is not the bee lane: /api/bee/* authenticates with a bee token and must never
// read a cookie (scripts/check-bee-routes.mjs enforces that).
//
// Two constructors, because Next.js allows cookie writes in Route Handlers and
// Server Actions but not in Server Components. Calling cookies().set() while
// rendering throws, so the read-only variant swallows the write instead of
// crashing a page render — the session is simply refreshed on the next request
// that can write.
// ----------------------------------------------------------------------------
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

function env(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error('supabase: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not configured');
  }
  return { url, anonKey };
}

/** For Route Handlers and Server Actions — may write session cookies. */
export function createSessionClient() {
  const { url, anonKey } = env();
  const store = cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
      setAll: (list: { name: string; value: string; options: CookieOptions }[]) => {
        for (const { name, value, options } of list) store.set(name, value, options);
      },
    },
  });
}

/** For Server Components — reads the session, never writes. */
export function createReadOnlySessionClient() {
  const { url, anonKey } = env();
  const store = cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll().map((c) => ({ name: c.name, value: c.value })),
      setAll: () => {
        /* not writable during render; refreshed on the next writable request */
      },
    },
  });
}
