// lib/antenna/db.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — the one service-role client the Antenna modules share.
// XI-1 v0.2.2 §6.11: Antenna's server routes use the app's existing Supabase
// service role, server-side. Antenna holds no model key; it is a pipe.
//
// The client is built lazily, on first call, and never at module scope. A
// module-scope createClient() throws at build time when the env is absent,
// which is what breaks `next build` for any route that imports it.
// ----------------------------------------------------------------------------
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * FIND-POLL-CACHE — every Antenna read must reach the database, every time.
 *
 * Next.js replaces global fetch with a caching wrapper and keeps a Data Cache
 * keyed on the request. supabase-js issues its reads as plain GETs with a stable
 * URL, so identical reads were served from that cache instead of from Postgres:
 * a poll at a cursor already polled kept returning items 0, while the same
 * cursor ±1 returned the new reply. `x-vercel-cache: BYPASS` on those responses
 * is what ruled the CDN out and pointed here.
 *
 * `cache: 'no-store'` on the fetch itself is the only layer that cannot be
 * overridden by a route-level default, because it is stated on the request. The
 * route exports are the second belt, not the first.
 */
function uncachedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, cache: 'no-store' });
}

let cached: SupabaseClient | null = null;

export function antennaAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('antenna: SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL are not configured');
  }
  cached = createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: uncachedFetch },
  });
  return cached;
}

/** Caller IP for audit rows and IP-keyed rate limits. Never trusted for auth. */
export function clientIp(req: { headers: { get(name: string): string | null } }): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) {
    const first = fwd.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.headers.get('x-real-ip');
}
