export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

// ----------------------------------------------------------------------------
// NIK-RAIL-000 — DEFUSED. Ruled by Francis Oct 12 (RAIL-DESIGN-v1.1 §15 row 0,
// ruling R-G).
//
// WHAT WAS HERE: a Vercel cron entry point. It checked a Bearer CRON_SECRET
// (and only when NODE_ENV === 'production'), then POSTed
// action='run_monthly_payouts' with HIVE_API_KEY in the request BODY to
// https://openthehive.ai/api/referrals/chain — an absolute URL, so a deploy
// preview would have driven production. That action marked pending earnings
// 'ready_for_payout'. This route was the one live caller of the whole legacy
// payout path: vercel.json fired it at 09:00 on the 1st of every month.
//
// The cron entry is removed from vercel.json in the same commit, so nothing
// invokes this path any more. The file stays, answering 410 Gone on EVERY
// method, because a cron that 404s is indistinguishable from a cron that was
// never configured, and the next person reading vercel.json should find the
// answer here rather than in git history.
// ----------------------------------------------------------------------------

const GONE = { error: 'gone', detail: 'replaced by the payout rail' } as const;
const gone = () => NextResponse.json(GONE, { status: 410 });

export const GET = gone;
export const POST = gone;
export const PUT = gone;
export const PATCH = gone;
export const DELETE = gone;
export const HEAD = gone;
export const OPTIONS = gone;
