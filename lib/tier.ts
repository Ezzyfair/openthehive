// lib/tier.ts
// ----------------------------------------------------------------------------
// THE HIVE — the one translation between Stripe's tier words and the colony's.
//
// Ruling (Francis, Sept 22): the DATABASE vocabulary is canonical —
//   scout · worker_bee · honey_maker · queens_council
// and Stripe's PRICE_MAP keys stay as they are. The translation happens once,
// here, at the boundary.
//
// Why this file exists: webhook/route.ts wrote session.metadata.tier straight into
// members.tier and agents.tier, so a paying Worker Bee's row read 'worker'. Every
// reader is canonical — colony-broadcast/route.ts:260 and :269, agents/[id]/page.tsx:115,
// cohort-assignment.ts:175 and :246, referral-engine.ts:57 — so a paying member
// matched none of them. The cohort call at webhook:151 had its own inline
// `tier === 'worker' ? 'worker_bee' : ...`, which was the only translation anywhere
// and covered exactly one of the three words.
// ----------------------------------------------------------------------------

/** The canonical DB vocabulary. Mirrors Tier in lib/cohort-assignment.ts. */
export type CanonicalTier = 'scout' | 'worker_bee' | 'honey_maker' | 'queens_council';

/**
 * Stripe checkout key -> canonical DB value.
 * Keys are exactly the PRICE_MAP keys in app/api/stripe/checkout/route.ts and the
 * `id` fields in app/pricing/page.tsx:6,24,43. Nothing else is accepted.
 */
export const STRIPE_TIER_TO_CANONICAL: Record<string, CanonicalTier> = {
  worker: 'worker_bee',
  honey: 'honey_maker',
  queens: 'queens_council',
};

/**
 * Translate, or fail loudly. There is deliberately NO default.
 *
 * A silent fallback is what produced this defect: `tier || 'worker'` turned an
 * absent tier into a paid Worker Bee row, and an unrecognised one would have been
 * written verbatim. A tier we cannot name is a signup we cannot classify, and
 * guessing it wrong is worse than refusing it — the caller returns 400 and Stripe
 * retries, which is the behaviour a money path should have.
 */
export function canonicalTier(stripeTier: unknown): CanonicalTier | null {
  if (typeof stripeTier !== 'string') return null;
  return STRIPE_TIER_TO_CANONICAL[stripeTier] ?? null;
}

/** Already-canonical values pass through; used when reading a stored tier. */
export function isCanonicalTier(value: unknown): value is CanonicalTier {
  return value === 'scout' || value === 'worker_bee' || value === 'honey_maker' || value === 'queens_council';
}
