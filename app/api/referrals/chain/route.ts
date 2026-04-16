export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );
}

// Commission rates by level (10 levels)
// Level 1 = direct recruit = 10%
// Each level down = 1% less
// Hive keeps the remainder
const LEVEL_RATES: Record<number, number> = {
  1: 0.10, 2: 0.09, 3: 0.08, 4: 0.07, 5: 0.06,
  6: 0.05, 7: 0.04, 8: 0.03, 9: 0.02, 10: 0.01
};

const SUBSCRIPTION_AMOUNT = 5.00; // $5/month Worker Bee
const MIN_PAYOUT_USD = 5.00; // Minimum $5 before payout

/**
 * Walk the referral chain up from a given agent
 * Returns array of {agent_id, level, rate} from direct recruiter up
 */
async function getReferralChain(supabase: any, agentId: string): Promise<Array<{agent_id: string, name: string, level: number, rate: number, wallet: string | null}>> {
  const chain = [];
  let currentAgentId = agentId;
  let level = 1;

  while (level <= 10) {
    // Find who referred the current agent
    const { data: currentAgent } = await supabase
      .from('agents')
      .select('id, name, referred_by_code, eth_wallet')
      .eq('id', currentAgentId)
      .single();

    if (!currentAgent?.referred_by_code) break;

    // Find the agent who has this referral code
    const { data: referrer } = await supabase
      .from('agents')
      .select('id, name, referral_code, eth_wallet')
      .eq('referral_code', currentAgent.referred_by_code)
      .single();

    if (!referrer) break;

    chain.push({
      agent_id: referrer.id,
      name: referrer.name,
      level,
      rate: LEVEL_RATES[level],
      wallet: referrer.eth_wallet || null,
    });

    currentAgentId = referrer.id;
    level++;
  }

  return chain;
}

/**
 * Calculate and record earnings for a single subscription payment
 */
async function processSubscriptionPayment(supabase: any, agentId: string, subscriptionMonth: string) {
  const chain = await getReferralChain(supabase, agentId);

  let totalPaidOut = 0;
  const earnings = [];

  for (const referrer of chain) {
    const earned = Math.round(SUBSCRIPTION_AMOUNT * referrer.rate * 100) / 100;
    totalPaidOut += earned;

    earnings.push({
      earning_agent_id: referrer.agent_id,
      source_agent_id: agentId,
      subscription_month: subscriptionMonth,
      level: referrer.level,
      percentage: referrer.rate * 100,
      subscription_amount: SUBSCRIPTION_AMOUNT,
      earned_amount: earned,
      status: 'pending',
      wallet_address: referrer.wallet,
    });

    // Add pollen to the earning agent (500 pollen = $5)
    const pollenEarned = Math.round(earned * 100); // 1 pollen = $0.01
    await supabase
      .from('agents')
      .update({ pollen_earned: supabase.rpc('increment_pollen', { agent_id: referrer.agent_id, amount: pollenEarned }) })
      .eq('id', referrer.agent_id);
  }

  if (earnings.length > 0) {
    await supabase.from('referral_earnings').insert(earnings);
  }

  // Record hive revenue
  const hivekept = Math.round((SUBSCRIPTION_AMOUNT - totalPaidOut) * 100) / 100;
  await supabase.from('hive_revenue').insert({
    source_agent_id: agentId,
    subscription_month: subscriptionMonth,
    subscription_amount: SUBSCRIPTION_AMOUNT,
    referral_paid_out: totalPaidOut,
    hive_kept: hivekept,
    chain_depth: chain.length,
  });

  return { chain, totalPaidOut, hiveKept: hivekept };
}

/**
 * GET /api/referrals/chain?agent_id=xxx
 * Returns the full referral chain for an agent
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get('agent_id');
  const action = searchParams.get('action');

  if (!agentId) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });

  const supabase = getSupabase();

  if (action === 'earnings') {
    // Get pending earnings for an agent
    const { data: earnings } = await supabase
      .from('referral_earnings')
      .select('*')
      .eq('earning_agent_id', agentId)
      .order('created_at', { ascending: false })
      .limit(50);

    const totalPending = earnings
      ?.filter(e => e.status === 'pending')
      .reduce((sum: number, e: any) => sum + e.earned_amount, 0) || 0;

    const totalPaid = earnings
      ?.filter(e => e.status === 'paid')
      .reduce((sum: number, e: any) => sum + e.earned_amount, 0) || 0;

    return NextResponse.json({
      earnings,
      totalPending,
      totalPaid,
      readyForPayout: totalPending >= MIN_PAYOUT_USD,
    });
  }

  // Default: return referral chain
  const chain = await getReferralChain(supabase, agentId);
  return NextResponse.json({ agentId, chain, chainDepth: chain.length });
}

/**
 * POST /api/referrals/chain
 * Process a subscription payment and distribute earnings
 */
export async function POST(req: NextRequest) {
  try {
    const { action, agent_id, subscription_month, api_key } = await req.json();

    // Only allow internal calls with Hive API key
    if (api_key !== process.env.HIVE_API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabase();

    if (action === 'process_payment') {
      const month = subscription_month || new Date().toISOString().slice(0, 7) + '-01';
      const result = await processSubscriptionPayment(supabase, agent_id, month);
      return NextResponse.json({ success: true, ...result });
    }

    if (action === 'run_monthly_payouts') {
      // Find all agents with pending earnings >= $5
      const { data: pendingEarnings } = await supabase
        .from('referral_earnings')
        .select('earning_agent_id, earned_amount')
        .eq('status', 'pending');

      if (!pendingEarnings) return NextResponse.json({ processed: 0 });

      // Group by agent
      const agentTotals: Record<string, number> = {};
      pendingEarnings.forEach((e: any) => {
        agentTotals[e.earning_agent_id] = (agentTotals[e.earning_agent_id] || 0) + e.earned_amount;
      });

      let processed = 0;
      const payouts = [];

      for (const [agentId, total] of Object.entries(agentTotals)) {
        if (total >= MIN_PAYOUT_USD) {
          // Get agent wallet
          const { data: agent } = await supabase
            .from('agents')
            .select('name, eth_wallet')
            .eq('id', agentId)
            .single();

          if (agent?.eth_wallet) {
            // Mark as ready for payout
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
