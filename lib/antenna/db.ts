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

let cached: SupabaseClient | null = null;

export function antennaAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('antenna: SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL are not configured');
  }
  cached = createClient(url, key, { auth: { persistSession: false } });
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
