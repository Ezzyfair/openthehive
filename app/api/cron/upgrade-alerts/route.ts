// app/api/cron/upgrade-alerts/route.ts
// ----------------------------------------------------------------------------
// THE HIVE · payout rail — the hourly repeat of the earlier-subscription alert.
// MEMBER-UPSERT-001-b item 2. Francis's ruling 9 (Nov 21, 2026): "every hour until
// it is cancelled". Scheduled in vercel.json at "0 * * * *".
//
// For every open to-do row of reason upgrade_old_subscription_open it sends the
// parent ticket's alert again, word for word (lib/rail/upgrade-alerts.ts). A row
// stops being sent when the webhook closes it (Stripe reports the earlier
// subscription over) or when a person sets its resolved_at by hand.
//
// AUTH — the gate of app/api/cron/antenna-prune/route.ts, copied, accepting only
// the one name Vercel's scheduler sends: Authorization: Bearer CRON_SECRET. It is
// compared in constant time and holds in every environment. No secret configured is
// a closed door.
// ----------------------------------------------------------------------------
import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { railAdmin } from '@/lib/rail/db';
import { sendOpenUpgradeAlerts } from '@/lib/rail/upgrade-alerts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
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

  const accepted = [process.env.CRON_SECRET].filter(
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

  const result = await sendOpenUpgradeAlerts(railAdmin());
  if (result.error) {
    console.error('upgrade alert: read failed', result.error?.message ?? String(result.error));
    return NextResponse.json({ error: 'read_failed' }, { status: 500 });
  }

  return NextResponse.json({ open: result.open });
}
