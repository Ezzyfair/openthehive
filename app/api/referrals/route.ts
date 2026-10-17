export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// §11 · the no-cache posture, the same four every bee route declares. A memoized
// balance read on a money route is the FIND-POLL-CACHE bug with money attached:
// railAdmin()'s cache:'no-store' is the first belt, these are the second.
export const fetchCache = 'force-no-store';
export const revalidate = 0;
import { NextRequest, NextResponse } from 'next/server';
import { railAdmin } from '@/lib/rail/db';
import { getAgentEarnings } from '@/lib/referral-engine';

// §11 · the money-path client. railAdmin() is service role with
// cache:'no-store' at the request level and persistSession:false; a bare
// Supabase constructor in this tree now fails scripts/check-rail-routes.mjs.
const getSupabase = railAdmin;

// GET /api/referrals?agent_key=hive_xxx — get earnings summary
export async function GET(req: NextRequest) {
  const agentKey = req.nextUrl.searchParams.get('agent_key');
  if (!agentKey) return NextResponse.json({ error: 'agent_key required' }, { status: 400 });

  const supabase = getSupabase();
  const { data: agent } = await supabase
    .from('agents')
    .select('id, name, referral_code, eth_wallet')
    .eq('agent_api_key', agentKey)
    .single();

  if (!agent) return NextResponse.json({ error: 'Invalid key' }, { status: 401 });

  const earnings = await getAgentEarnings(agent.id, supabase);

  // Count direct recruits
  const { count: directRecruits } = await supabase
    .from('agents')
    .select('id', { count: 'exact', head: true })
    .eq('referred_by_code', agent.referral_code);

  return NextResponse.json({
    agent: agent.name,
    referral_code: agent.referral_code,
    referral_link: 'https://openthehive.ai/join?ref=' + agent.referral_code,
    wallet: agent.eth_wallet || 'not set',
    direct_recruits: directRecruits || 0,
    earnings: {
      pending: earnings.pendingTotal.toFixed(2),
      paid: earnings.paidTotal.toFixed(2),
      ready_for_payout: earnings.readyForPayout,
      minimum_payout: '$5.00',
    },
    recent_earnings: earnings.pendingEarnings.slice(0, 10),
  });
}

// NIK-RAIL-000 — DEFUSED. Ruled by Francis Oct 12 (RAIL-DESIGN-v1.1 §15 row 0, R-G).
//
// WHAT WAS HERE: POST called the legacy accrual writer in lib/referral-engine.ts —
// it CREATED ACCRUALS in referral_earnings and hive_revenue — and it checked NO
// credential at all. Not a key, not a signature, not a secret: any unauthenticated
// request with three JSON fields minted commission rows for any agent id, at any
// amount, for any month. Its own comment claimed it was "called by Stripe webhook
// monthly", which was never true; the webhook calls the engine directly
// (app/api/stripe/webhook/route.ts:170).
//
// Returns 410 Gone and does nothing else — no auth check, no database call, no Stripe
// call. /api/stripe/webhook is the only writer of accruals.
export async function POST() {
  return NextResponse.json(
    { error: 'gone', detail: 'replaced by the payout rail' },
    { status: 410 },
  );
}
