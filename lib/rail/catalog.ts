// lib/rail/catalog.ts
// ----------------------------------------------------------------------------
// THE HIVE · payout rail — the declared list of membership prices.
// RAIL-DESIGN-v1.1 §5.5a (closes H5).
//
// §5.5a: "lib/rail/catalog.ts is the single declared list of membership prices:
// the three price ids already read from env by app/api/stripe/checkout/route.ts,
// per mode. A payment accrues only if every line item's price is in that list for
// the event's mode. Anything else writes nothing to the ledger and records a
// stripe_webhook_failures row with reason 'non_membership_payment' (no alert
// email; it is information, not a fault)."
//
// WHY AN ALLOW-LIST AND NOT A DENY-LIST. Without it, any future Stripe product —
// a Skill Vault one-off, a bounty, a sponsorship, a refundable deposit — would
// flow through the same webhook and mint referral commission on a payment that is
// not a membership. An allow-list fails closed on something nobody has invented
// yet; a deny-list fails open on exactly that.
//
// ENV NAMES ONLY. The three ids are read from the environment by NAME at call
// time. No price id is written into this file, because the test-mode and live-mode
// ids differ and a hardcoded one would silently be the wrong mode's. No key of
// any kind appears here or is read here.
// ----------------------------------------------------------------------------

/** The three membership tiers, as `app/api/stripe/checkout/route.ts` names them. */
export type MembershipTier = 'worker' | 'honey' | 'queens';

/**
 * The Stripe mode a tier's payment arrives in. Worker Bee and Honey Maker are
 * recurring; Queen's Council is a one-time charge, which is why §5.5 gives it a
 * payment-intent ref rather than an invoice ref.
 */
export type StripeMode = 'subscription' | 'payment';

/**
 * One declared membership price. `amountCents` is an INTEGER number of cents and
 * never a float: §4.2 stores money as integer cents, D5 records that the legacy
 * engine used floating-point dollars, and 7.9 * 100 is not 790 in IEEE 754.
 */
export interface MembershipPrice {
  tier: MembershipTier;
  /** The ENV VAR NAME holding the Stripe price id. Never the id, never a key. */
  priceIdEnvVar: string;
  mode: StripeMode;
  amountCents: number;
  /** Buyer-facing label. Rates and amounts belong on /economics, not in copy. */
  label: string;
}

/**
 * THE CATALOG. The same three env names `checkout/route.ts` builds its PRICE_MAP
 * from, so the list a payment is checked against is by construction the list a
 * checkout can create.
 *
 * Amounts are the tier prices settled in the Bible and already public on
 * /pricing: Worker Bee $10/mo, Honey Maker $79/yr, Queen's Council $249 one-time.
 * They are carried here so a payment's amount can be sanity-checked against the
 * tier it claims to be, not to be rendered anywhere.
 */
export const MEMBERSHIP_PRICES: readonly MembershipPrice[] = [
  {
    tier: 'worker',
    priceIdEnvVar: 'STRIPE_WORKER_BEE_PRICE_ID',
    mode: 'subscription',
    amountCents: 1000,
    label: 'Worker Bee',
  },
  {
    tier: 'honey',
    priceIdEnvVar: 'STRIPE_HONEY_MAKER_PRICE_ID',
    mode: 'subscription',
    amountCents: 7900,
    label: 'Honey Maker',
  },
  {
    tier: 'queens',
    priceIdEnvVar: 'STRIPE_QUEENS_COUNCIL_PRICE_ID',
    mode: 'payment',
    amountCents: 24900,
    label: "Queen's Council",
  },
] as const;

/**
 * The declared price ids for the CURRENT environment, resolved from env by name.
 *
 * Read at call time, never at module scope: the same reason railStripe() is lazy —
 * a preview builds without these set, and a module-scope read would bake an
 * `undefined` into the bundle.
 *
 * An env var that is absent or empty is OMITTED rather than included as undefined,
 * so `isMembershipPrice` cannot accidentally match a line item whose price is also
 * undefined. A missing env var therefore makes that tier's payments fail the check
 * and be recorded as non-membership — visible, not silent.
 */
export function declaredPriceIds(): string[] {
  const out: string[] = [];
  for (const p of MEMBERSHIP_PRICES) {
    const id = process.env[p.priceIdEnvVar];
    if (id && id.trim() !== '') out.push(id.trim());
  }
  return out;
}

/** The declared price ids for one mode only, resolved from env by name. */
export function declaredPriceIdsForMode(mode: StripeMode): string[] {
  const out: string[] = [];
  for (const p of MEMBERSHIP_PRICES) {
    if (p.mode !== mode) continue;
    const id = process.env[p.priceIdEnvVar];
    if (id && id.trim() !== '') out.push(id.trim());
  }
  return out;
}

/**
 * Is this price id a declared membership price for this mode?
 *
 * A null, undefined or blank price id is NOT a membership price. §5.5a requires
 * that EVERY line item's price be in the list, so a line item carrying no price
 * at all must fail — otherwise a mixed cart of one membership and one unpriced
 * item would pass.
 */
export function isMembershipPrice(priceId: string | null | undefined, mode: StripeMode): boolean {
  if (!priceId || priceId.trim() === '') return false;
  return declaredPriceIdsForMode(mode).includes(priceId.trim());
}

/** The tier a declared price id belongs to, or null. Env is read by name. */
export function tierForPriceId(priceId: string | null | undefined): MembershipTier | null {
  if (!priceId || priceId.trim() === '') return null;
  const want = priceId.trim();
  for (const p of MEMBERSHIP_PRICES) {
    const id = process.env[p.priceIdEnvVar];
    if (id && id.trim() === want) return p.tier;
  }
  return null;
}

/** The reason string §5.5a names for a payment that is not a membership. */
export const NON_MEMBERSHIP_REASON = 'non_membership_payment';
