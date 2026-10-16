/**
 * lib/referral-engine.ts — The Hive 2-level referral bonus engine
 *
 * READ-ONLY SINCE NIK-RAIL-004. This module no longer writes anything: its one
 * writer is deleted, and every accrual now goes through the rail_accrue database
 * function, called once from lib/rail/accrual.ts. That is predicate R60, which
 * scripts/check-rail-routes.mjs enforces — this file needed a printed exemption
 * there until this commit and no longer does.
 *
 * Used by:
 *   - /api/referrals (GET earnings dashboard)
 *   - /api/referrals/chain (GET chain and GET ?action=earnings; its POST is 410)
 *   - /api/stripe/webhook, through lib/rail/accrual.ts, for buildReferralChain only
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
 * THE LEGACY WRITER WAS DELETED HERE (NIK-RAIL-004). It is not named in this
 * comment on purpose: the commit's proof is that its symbol greps to zero across
 * app/ and lib/, and a comment spelling it would make that impossible to state.
 *
 * What it did, and why none of it survives: it inserted referral_earnings and
 * hive_revenue rows directly; keyed idempotency on (source_agent_id,
 * subscription_month) with a read-then-write race (D3); took the month from the
 * server clock rather than the invoice (D4); computed amounts as floating-point
 * dollars (D5); and ignored the returned error on both inserts (D7).
 *
 * Its replacement is the rail_accrue database function, called exactly once from
 * lib/rail/accrual.ts: the invoice reference is the idempotency key, the month comes
 * from the invoice, amounts are integer cents, and the RPC error is checked and
 * surfaced so Stripe retries.
 */

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
