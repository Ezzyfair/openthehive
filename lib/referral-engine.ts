// Referral Chain Engine
// Calculates and records earnings for the full 10-level cascade

import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );
}

// Commission rates by level
// Level 1 = direct recruit = 10%
// Level 2 = 9%, Level 3 = 8%... Level 10 = 1%
// Beyond Level 10 = 0% (Hive keeps all)
export function getCommissionRate(level: number): number {
  if (level < 1 || level > 10) return 0;
  return (11 - level) / 100; // Level 1 = 10%, Level 10 = 1%
}

export function getHiveRate(level: number): number {
  if (level > 10) return 1.0; // Hive keeps 100% beyond level 10
  return level / 100; // Level 1 = 0% to hive, Level 10 = 9% to hive
  // Wait — let me recalculate:
  // Level 1: agent gets 10%, hive gets 0% extra (hive already keeps 90%)
  // The hive always gets (100% - sum of all cascade percentages)
  // On a $10 sub with only direct referral: $1.00 to agent, $9.00 to hive
  // This function just tracks cascade splits
}

// Walk up the referral chain from a new agent
// Returns array of {agentId, level, percentage} for all earners
export async function buildReferralChain(newAgentId: string, supabase: any): Promise<Array<{
  agentId: string;
  agentName: string;
  level: number;
  percentage: number;
  walletAddress: string | null;
}>> {
  const chain = [];
  let currentAgentId = newAgentId;
  let level = 1;

  while (level <= 10) {
    // Find who referred the current agent
    const { data: agent } = await supabase
      .from('agents')
      .select('id, name, referred_by_code, eth_wallet')
      .eq('id', currentAgentId)
      .single();

    if (!agent || !agent.referred_by_code) break;

    // Find the referrer by their referral code
    const { data: referrer } = await supabase
      .from('agents')
      .select('id, name, eth_wallet, referral_code')
      .eq('referral_code', agent.referred_by_code)
      .single();

    if (!referrer) break;

    chain.push({
      agentId: referrer.id,
      agentName: referrer.name,
      level,
      percentage: getCommissionRate(level),
      walletAddress: referrer.eth_wallet || null,
    });

    currentAgentId = referrer.id;
    level++;
  }

  return chain;
}

// Calculate and record monthly earnings for a subscription payment
export async function recordSubscriptionEarnings(
  subscribingAgentId: string,
  subscriptionAmount: number, // e.g., 10.00
  subscriptionMonth: string,  // e.g., '2026-04-01'
  supabase: any
): Promise<{
  totalPaidOut: number;
  hiveKept: number;
  chain: Array<{ name: string; level: number; amount: number }>;
}> {
  const chain = await buildReferralChain(subscribingAgentId, supabase);

  let totalPaidOut = 0;
  const earnings = [];

  for (const earner of chain) {
    const earnedAmount = subscriptionAmount * earner.percentage;
    totalPaidOut += earnedAmount;

    // Record earning
    await supabase.from('referral_earnings').insert({
      earning_agent_id: earner.agentId,
      source_agent_id: subscribingAgentId,
      subscription_month: subscriptionMonth,
      level: earner.level,
      percentage: earner.percentage * 100,
      subscription_amount: subscriptionAmount,
      earned_amount: earnedAmount,
      status: 'pending',
      wallet_address: earner.walletAddress,
    });

    earnings.push({
      name: earner.agentName,
      level: earner.level,
      amount: earnedAmount,
    });
  }

  const hiveKept = subscriptionAmount - totalPaidOut;

  // Record hive revenue
  await supabase.from('hive_revenue').insert({
    source_agent_id: subscribingAgentId,
    subscription_month: subscriptionMonth,
    subscription_amount: subscriptionAmount,
    referral_paid_out: totalPaidOut,
    hive_kept: hiveKept,
    chain_depth: chain.length,
  });

  return { totalPaidOut, hiveKept, chain: earnings };
}

// Get total pending earnings for an agent
export async function getAgentEarnings(agentId: string, supabase: any) {
  const { data: pending } = await supabase
    .from('referral_earnings')
    .select('earned_amount, level, created_at')
    .eq('earning_agent_id', agentId)
    .eq('status', 'pending');

  const { data: paid } = await supabase
    .from('referral_earnings')
    .select('earned_amount')
    .eq('earning_agent_id', agentId)
    .eq('status', 'paid');

  const pendingTotal = (pending || []).reduce((sum: number, e: any) => sum + e.earned_amount, 0);
  const paidTotal = (paid || []).reduce((sum: number, e: any) => sum + e.earned_amount, 0);

  return {
    pendingTotal,
    paidTotal,
    pendingEarnings: pending || [],
    readyForPayout: pendingTotal >= 5.00, // $5 minimum
  };
}
