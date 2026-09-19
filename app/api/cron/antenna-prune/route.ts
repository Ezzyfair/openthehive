// app/api/cron/antenna-prune/route.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — daily prune of the rate-limit counters (Nikita M1).
//
// bee_rate_limits accumulates one row per (scope, identity, window). Nothing on
// the request path deletes them, so without this they grow without bound. The
// rows are worthless the moment their window closes; antenna_rate_prune()
// removes every expired one and returns the count.
//
// AUTH — read this before changing the env var name. Vercel's scheduler sends
// `Authorization: Bearer $CRON_SECRET` and only that name; CRON_SECRET is the
// reserved variable it knows about. Gating on ANTENNA_CRON_SECRET alone would
// 401 every night, silently, and the table would grow anyway. So this route
// accepts EITHER — ANTENNA_CRON_SECRET first, CRON_SECRET as the fallback the
// platform actually sends. Both are compared in constant time.
//
// Unlike the other cron routes in this repo, there is no
// `&& NODE_ENV === 'production'` escape: the gate holds in every environment.
// ----------------------------------------------------------------------------
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { antennaAdmin } from '@/lib/antenna/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// FIND-POLL-CACHE — 'force-dynamic' governs how the ROUTE is rendered and
// revalidated. It does not stop Next.js serving an individual fetch inside the
// handler from the Data Cache, which is what froze /poll at an already-seen
// cursor. These two make the route's own fetch policy explicit; the request-level
// cache: 'no-store' in the supabase clients is the layer that actually holds.
export const fetchCache = 'force-no-store';
export const revalidate = 0;

function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function authorized(req: NextRequest): boolean {
  const header = req.headers.get('authorization');
  if (!header) return false;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!m) return false;
  const presented = m[1].trim();

  const accepted = [process.env.ANTENNA_CRON_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === 'string' && s.length > 0,
  );
  // No secret configured is a closed door, not an open one.
  if (accepted.length === 0) return false;
  return accepted.some((secret) => constantTimeEquals(presented, secret));
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { data, error } = await antennaAdmin().rpc('antenna_rate_prune');
  if (error) {
    console.error('antenna: rate prune failed', error.message);
    return NextResponse.json({ error: 'prune_failed' }, { status: 500 });
  }

  const deleted = typeof data === 'number' ? data : 0;
  console.log('antenna: rate prune removed', deleted, 'expired bucket(s)');
  return NextResponse.json({ pruned: deleted });
}
