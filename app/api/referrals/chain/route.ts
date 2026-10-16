export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// §11 · the no-cache posture, the same four every bee route declares. A memoized
// balance read on a money route is the FIND-POLL-CACHE bug with money attached:
// railAdmin()'s cache:'no-store' is the first belt, these are the second.
export const fetchCache = 'force-no-store';
export const revalidate = 0;
import { NextRequest, NextResponse } from 'next/server';
import { railAdmin } from '@/lib/rail/db';
import { buildReferralChain } from '@/lib/referral-engine';

// §11 · the money-path client. railAdmin() is service role with
// cache:'no-store' at the request level and persistSession:false; a bare
// Supabase constructor in this tree now fails scripts/check-rail-routes.mjs.
const getSupabase = railAdmin;

// DEFAULT_SUBSCRIPTION_AMOUNT went with the defused POST (NIK-RAIL-000): a default
// amount is exactly what let a cascade be minted without an invoice.
const MIN_PAYOUT_USD = 5.00;

/**
 * GET /api/referrals/chain?agent_id=xxx
 * Returns the full referral chain for an agent.
 *
 * GET /api/referrals/chain?agent_id=xxx&action=earnings
 * Returns pending+paid earnings for an agent.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get('agent_id');
  const action = searchParams.get('action');

  if (!agentId) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });

  const supabase = getSupabase();

  if (action === 'earnings') {
    const { data: earnings } = await supabase
      .from('referral_earnings')
      .select('*')
      .eq('earning_agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(50);

    const totalPending = earnings
      ?.filter((e: any) => e.status === 'pending')
      .reduce((sum: number, e: any) => sum + e.earned_amount, 0) || 0;

    const totalPaid = earnings
      ?.filter((e: any) => e.status === 'paid')
      .reduce((sum: number, e: any) => sum + e.earned_amount, 0) || 0;

    return NextResponse.json({
      earnings,
      totalPending,
      totalPaid,
      readyForPayout: totalPending >= MIN_PAYOUT_USD,
    });
  }

  // Default: return referral chain — shape kept compatible with prior consumers.
  const rawChain = await buildReferralChain(agentId, supabase);
  const chain = rawChain.map(c => ({
    agent_id: c.agentId,
    name: c.agentName,
    level: c.level,
    rate: c.percentage,
    wallet: c.walletAddress,
  }));
  return NextResponse.json({ agentId, chain, chainDepth: chain.length });
}

/**
 * POST /api/referrals/chain — NIK-RAIL-000 DEFUSED.
 * Ruled by Francis Oct 12 (RAIL-DESIGN-v1.1 §15 row 0, ruling R-G).
 *
 * BOTH actions this method carried wrote money, so the whole method is gone — and the
 * api_key check and the service-role client went with it, because rule 1 is "no auth
 * check before it, no database call": a 410 that first validates a key is an oracle for
 * whether that key is still live.
 *
 *   action='process_payment' — called the legacy accrual writer, CREATING accruals
 *     in referral_earnings and hive_revenue. Amount DEFAULTED to $10 and the month
 *     defaulted to now, so a caller holding the key could mint a cascade for any agent
 *     id with two fields and no invoice behind it. The Stripe webhook does this
 *     properly, keyed to a real invoice (app/api/stripe/webhook/route.ts:170).
 *
 *   action='run_monthly_payouts' — swept every pending row and ran
 *     UPDATE referral_earnings SET status='ready_for_payout' for any agent over $5
 *     WITH A NON-NULL eth_wallet, i.e. it gated real money on a crypto column that the
 *     Stripe Connect rail does not use. Its one caller was the monthly cron at
 *     /api/payouts/monthly, whose vercel.json entry is removed in this commit.
 *
 * The GET handlers above are untouched: they read, they take no credential from the
 * URL, and the chain view is still the honest answer to "who is in my chain".
 */
export async function POST() {
  return NextResponse.json(
    { error: 'gone', detail: 'replaced by the payout rail' },
    { status: 410 },
  );
}
