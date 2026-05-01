/**
 * lib/referral-engine.ts — The Hive 10-level referral cascade engine
 *
 * Single source of truth for cascade calculations. Used by:
 *   - /api/referrals (GET dashboard, POST cascade trigger — legacy)
 *   - /api/referrals/chain (GET chain, POST process_payment + run_monthly_payouts)
 *   - /api/stripe/webhook (cascade trigger on paid invoice + one-time checkout)
 *
 * V4 §1.1: Cascade distributes 55% of every paid subscription across 10 levels
 *   (10/9/8/7/6/5/4/3/2/1%). Hive retains the remainder minus Stripe fees.
 *
 * V4 §2.3: This module does NOT touch Pollen. Pollen is recognition, earned via
 *   outcome events (mastery verification, retention milestones, contributions),
 *   tracked in pollen_transactions ledger (forthcoming). Cascade earnings are
 *   real money, tracked in referral_earnings — never confused with Pollen.
 *
 * Tier-agnostic: caller passes the actual amount paid. Worker Bee monthly = $10.
 *   Honey Maker annual = $79. Queen's Council lifetime = $249. Same 10-level
 *   distribution applies to all.
 */

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

// On a $10 sub with full 10-level cascade:
//   Cascade pays out: 10+9+8+7+6+5+4+3+2+1 = 55% = $5.50
//   Hive retains: 45% = $4.50 (minus Stripe fees ~$0.59)
// On shallower chains (e.g., L1 only), the unused cascade percentages stay with the Hive.

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

/**
 * Calculate and record earnings for a subscription payment.
 *
 * Idempotency: skipped if (source_agent_id, subscription_month) tuple already
 * has an earnings row. Prevents double-cascade on Stripe webhook retries.
 * For one-time tiers (QC lifetime, Honey Maker annual), subscription_month is
 * the calendar month the payment occurred — acceptable since duplicate one-time
 * payments in the same month for the same agent aren't expected.
 */
export async function recordSubscriptionEarnings(
  subscribingAgentId: string,
  subscriptionAmount: number, // e.g., 10.00 (Worker Bee), 79.00 (Honey Maker), 249.00 (QC)
  subscriptionMonth: string,  // e.g., '2026-04-01'
  supabase: any
): Promise<{
  totalPaidOut: number;
  hiveKept: number;
  chain: Array<{ name: string; level: number; amount: number }>;
  skipped?: boolean;
  reason?: string;
}> {
  // Idempotency: skip if cascade already fired for this agent in this month
  const { data: existing } = await supabase
    .from('referral_earnings')
    .select('id')
    .eq('source_agent_id', subscribingAgentId)
    .eq('subscription_month', subscriptionMonth)
    .limit(1);

  if (existing && existing.length > 0) {
    return {
      totalPaidOut: 0,
      hiveKept: 0,
      chain: [],
      skipped: true,
      reason: 'duplicate_month',
    };
  }

  const chain = await buildReferralChain(subscribingAgentId, supabase);

  let totalPaidOut = 0;
  const earnings = [];
  const earningsRows = [];

  for (const earner of chain) {
    const earnedAmount = Math.round(subscriptionAmount * earner.percentage * 100) / 100;
    totalPaidOut += earnedAmount;

    earningsRows.push({
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

  if (earningsRows.length > 0) {
    await supabase.from('referral_earnings').insert(earningsRows);
  }

  const hiveKept = Math.round((subscriptionAmount - totalPaidOut) * 100) / 100;

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
