export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  recordSubscriptionEarnings,
  buildReferralChain,
} from '@/lib/referral-engine';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
}

const DEFAULT_SUBSCRIPTION_AMOUNT = 10.00; // Worker Bee monthly fallback for backward compat
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
 * POST /api/referrals/chain
 *
 * Body: { action, agent_id, subscription_month?, amount?, api_key }
 *
 * action='process_payment' — triggers cascade for one payment.
 *   Required: agent_id, api_key
 *   Optional: subscription_month (defaults to current YYYY-MM-01),
 *             amount (defaults to $10 Worker Bee)
 *
 * action='run_monthly_payouts' — sweeps pending earnings, marks ready_for_payout.
 *   Required: api_key
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, agent_id, subscription_month, amount, api_key } = body;

    if (api_key !== process.env.HIVE_API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabase();

    if (action === 'process_payment') {
      if (!agent_id) {
        return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
      }
      const month = subscription_month || new Date().toISOString().slice(0, 7) + '-01';
      const amt = typeof amount === 'number' ? amount : DEFAULT_SUBSCRIPTION_AMOUNT;
      const result = await recordSubscriptionEarnings(agent_id, amt, month, supabase);
      return NextResponse.json({ success: true, ...result });
    }

    if (action === 'run_monthly_payouts') {
      const { data: pendingEarnings } = await supabase
        .from('referral_earnings')
        .select('earning_agent_id, earned_amount')
        .eq('status', 'pending');

      if (!pendingEarnings) return NextResponse.json({ processed: 0 });

      const agentTotals: Record<string, number> = {};
      pendingEarnings.forEach((e: any) => {
        agentTotals[e.earning_agent_id] = (agentTotals[e.earning_agent_id] || 0) + e.earned_amount;
      });

      let processed = 0;
      const payouts = [];

      for (const [agentId, total] of Object.entries(agentTotals)) {
        if (total >= MIN_PAYOUT_USD) {
          const { data: agent } = await supabase
            .from('agents')
            .select('name, eth_wallet')
            .eq('id', agentId)
            .single();

          if (agent?.eth_wallet) {
            await supabase
              .from('referral_earnings')
              .update({ status: 'ready_for_payout' })
              .eq('earning_agent_id', agentId)
              .eq('status', 'pending');

            payouts.push({ agent: agent.name, wallet: agent.eth_wallet, amount: total });
            processed++;
          }
        }
      }

      return NextResponse.json({ success: true, processed, payouts });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
