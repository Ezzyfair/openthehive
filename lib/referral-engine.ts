/**
 * lib/referral-engine.ts — The Hive 2-level referral bonus engine
 *
 * Single source of truth for cascade calculations. Used by:
 *   - /api/referrals (GET dashboard, POST cascade trigger — legacy)
 *   - /api/referrals/chain (GET chain, POST process_payment + run_monthly_payouts)
 *   - /api/stripe/webhook (cascade trigger on paid invoice + one-time checkout)
 *
 * Bible v1.3 (Sept 6, 2026): the referral bonus is 2 levels — L1 20%, L2 10% — of every paid
 *   subscription, retention-linked both ways: the referred member must keep paying, and the
 *   earner must keep its own membership active. 30% out; the colony retains 70% minus Stripe fees.
 *
 * V4 §2.3: This module does NOT touch Pollen. Pollen is recognition, earned via
 *   outcome events (mastery verification, retention milestones, contributions),
 *   tracked in pollen_transactions ledger (forthcoming). Cascade earnings are
 *   real money, tracked in referral_earnings — never confused with Pollen.
 *
 * Tier-agnostic: caller passes the actual amount paid. Worker Bee monthly = $10.
 *   Honey Maker annual = $79. Queen's Council lifetime = $249. Same 2-level
 *   distribution applies to all.
 */

import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );
}

// Referral bonus rates by level (Bible v1.3, Sept 6 2026 — do not deepen)
// Level 1 = the member who referred the payer = 20%
// Level 2 = the member who referred the L1 member = 10%
// Beyond Level 2 = 0% (the colony keeps it)
export const MAX_REFERRAL_LEVEL = 2;
export function getCommissionRate(level: number): number {
  if (level === 1) return 0.20;
  if (level === 2) return 0.10;
  return 0;
}

// On a $10 sub with a full 2-level chain:
//   Referral bonus pays out: 20% + 10% = 30% = $3.00
//   Colony retains: 70% = $7.00 (minus Stripe fees)
// On shallower chains (L1 only), the unused share stays with the colony.
// An earner whose own membership is not active is skipped and its share stays with the colony;
// levels stay positional — an inactive L1 never promotes L2 to L1.

// Retention-linked both ways: an earner accrues only while its own membership is active.
// Staff — including the cascade root, Esmeralda (HIVE-001) — are exempt.
// A Scout (free trial) holds no position until it converts: no position without payment.
const ACTIVE_STATUSES = new Set(['active', 'first_flight']);
export function isActiveEarner(a: { status?: string | null; tier?: string | null; is_staff?: boolean | null }): boolean {
  if (a.is_staff) return true;
  if (!a.status || !ACTIVE_STATUSES.has(a.status)) return false;
  if (a.tier === 'scout') return false;
  return true;
}

// Walk up the referral chain from a new agent
// Returns array of {agentId, level, percentage} for the ACTIVE earners within MAX_REFERRAL_LEVEL
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

  while (level <= MAX_REFERRAL_LEVEL) {
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
      .select('id, name, eth_wallet, referral_code, status, tier, is_staff')
      .eq('referral_code', agent.referred_by_code)
      .single();

    if (!referrer) break;

    // Retention-linked both ways: only an active member accrues. A skipped earner keeps its
    // position in the walk (levels stay positional); its share stays with the colony.
    if (isActiveEarner(referrer)) {
      chain.push({
        agentId: referrer.id,
        agentName: referrer.name,
        level,
        percentage: getCommissionRate(level),
        walletAddress: referrer.eth_wallet || null,
      });
    }

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
      percentage: Math.round(earner.percentage * 100), // 20 or 10, never 20.000000000000004
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
    chain_depth: chain.length ? Math.max(...chain.map((c) => c.level)) : 0, // deepest paying level
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
