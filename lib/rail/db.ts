// lib/rail/db.ts
// ----------------------------------------------------------------------------
// THE HIVE · payout rail — the one service-role client every money route shares.
// RAIL-DESIGN-v1.1 §5.2, §11.
//
// §5.2: "One database client factory, lib/rail/db.ts railAdmin(): service role,
// cache: 'no-store' at the request level, persistSession: false. Same
// construction as antennaAdmin()."
//
// THE CONSTRUCTION IS COPIED, NOT IMPORTED, and that is deliberate (this ticket
// says so explicitly). lib/antenna/db.ts belongs to the Antenna lane, whose
// predicates and review history are its own; a money route importing it would
// couple the rail's cache posture to a file that a future Antenna ticket may
// change for Antenna's reasons. Two small identical factories that each state
// their own rule are safer here than one shared one. The duplication is four
// lines and it is on purpose.
// ----------------------------------------------------------------------------
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * FIND-POLL-CACHE, carried into the money path as predicate §11.
 *
 * Next.js replaces global fetch with a caching wrapper and keeps a Data Cache
 * keyed on the request. supabase-js issues its reads as plain GETs with a stable
 * URL, so two identical reads in one request window can be served from that cache
 * instead of from Postgres. On the Antenna lane that froze a cursor; on the money
 * path the same mechanism would serve a STALE BALANCE — a payout run reading a
 * pending total that another transaction had already claimed.
 *
 * `cache: 'no-store'` on the fetch itself is the only layer a route-level default
 * cannot override, because it is stated on the request. The four route exports are
 * the second belt, not the first.
 */
function uncachedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, cache: 'no-store' });
}

let cached: SupabaseClient | null = null;

/**
 * The money-path database client: service role, uncached reads, no session.
 *
 * Built lazily on first call and never at module scope — a module-scope
 * createClient() throws at build time when the env is absent, which breaks
 * `next build` for every route that imports it.
 *
 * persistSession: false because there is no session here to persist. The service
 * role is not a user; writing a session to disk or memory on a money route would
 * be a token nobody asked for.
 */
export function railAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('rail: SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL are not configured');
  }
  cached = createClient(url, key, {
    auth: { persistSession: false },
    global: { fetch: uncachedFetch },
  });
  return cached;
}
