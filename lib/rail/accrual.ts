// lib/rail/accrual.ts
// ----------------------------------------------------------------------------
// THE HIVE · payout rail — the accrual logic, as pure functions with injected
// dependencies. RAIL-DESIGN-v1.1 §5, predicates R1-R11, R15, R47.
//
// WHY A SEPARATE FILE WITH INJECTED DEPS. Row 4's gate is "replay and concurrency
// self-test against the real handler with stubbed Stripe". The repo has no test
// runner and no HTTP harness, so the only way to exercise this logic in a test is
// for it to take its Stripe client and its database client as arguments rather
// than reach for module-scope factories. Everything here is a plain function of
// its inputs; the route wires railStripe() and railAdmin() in.
//
// Nothing in this file constructs a client, reads an env var, or knows about
// NextRequest. It also never writes to referral_earnings, hive_revenue or payouts
// directly — every write goes through one rpc('rail_accrue') call, which is R60
// and is why scripts/check-rail-routes.mjs exempts lib/rail/ from its write fence
// rather than this file needing an exemption of its own.
// ----------------------------------------------------------------------------
import type Stripe from 'stripe';
import { isMembershipPrice, NON_MEMBERSHIP_REASON, type StripeMode } from './catalog';

/**
 * The minimal database surface this module uses. Satisfied by a SupabaseClient and
 * by the in-memory fake the self-test injects.
 *
 * `rpc` returns PromiseLike, not Promise, and that is deliberate: supabase-js
 * returns a thenable PostgrestFilterBuilder rather than a real Promise, so a
 * Promise return type here makes the real client fail to satisfy this interface
 * (measured — tsc TS2345, "missing the following properties from type Promise:
 * catch, finally"). PromiseLike is exactly what `await` needs and nothing more.
 */
export interface AccrualDb {
  from(table: string): any;
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: any }>;
}

export interface AccrualDeps {
  stripe: Stripe;
  db: AccrualDb;
  /** Injected so a test can fix the clock. The route passes () => new Date(). */
  now: () => Date;
}

/** One accrual row as rail_accrue's p_rows contract defines it (§4.7). */
export interface AccrualRow {
  earning_agent_id: string;
  level: number;
  rate_bps: number;
  amount_cents: number;
}

/** What one invoice or one-time payment resolves to, from Stripe itself. */
export interface ResolvedPayment {
  ref: string;
  amountCents: number;
  customerId: string | null;
  /** UTC first-of-month, as 'YYYY-MM-01'. Never from the server clock (R5). */
  periodMonth: string;
  livemode: boolean;
  /** Every line item's price id. A null entry means a line item with no price. */
  priceIds: Array<string | null>;
}

export type AccrualOutcome =
  | { kind: 'zero' }
  | { kind: 'non_membership'; reason: string; priceIds: Array<string | null> }
  | { kind: 'written'; rows: AccrualRow[] }
  | { kind: 'replay' };

// ── helpers ─────────────────────────────────────────────────────────────────

/**
 * A Stripe unix timestamp → the UTC first day of its month, 'YYYY-MM-01'.
 *
 * Date.UTC and getUTC* only: the period month must not shift because the server
 * happens to run west of Greenwich. An invoice period starting 2026-11-01T00:30Z
 * is November everywhere; read with local getters in New York it would be October.
 */
export function utcFirstOfMonth(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}

/**
 * The price id of one INVOICE line item, for the pinned API version.
 *
 * MEASURED AGAINST THE INSTALLED SDK (stripe 22.0.1, ApiVersion
 * "2026-03-25.dahlia"), not assumed: InvoiceLineItem has NO top-level `price` in
 * this version. The id lives at
 *     line.pricing.price_details.price        (string | Price)
 * per node_modules/stripe/esm/resources/InvoiceLineItems.d.ts — `pricing:
 * InvoiceLineItem.Pricing | null` at :63, and `price: string | Price` inside
 * Pricing.PriceDetails. The grep is in the packet.
 *
 * Returns null when the line carries no price at all, which §5.5a treats as not a
 * membership rather than as absent — see accrueForSource.
 */
export function invoiceLinePriceId(line: Stripe.InvoiceLineItem): string | null {
  const details = line.pricing?.price_details;
  if (!details) return null;
  const p = details.price;
  if (!p) return null;
  return typeof p === 'string' ? p : p.id ?? null;
}

/**
 * The price id of one CHECKOUT SESSION line item.
 *
 * A DIFFERENT SHAPE from the invoice line, also measured: Checkout's LineItem has
 * `price: Price | null` (node_modules/stripe/esm/resources/LineItems.d.ts:49), an
 * expanded object rather than pricing.price_details. Two readers, because the SDK
 * genuinely models them differently; one shared reader would have to guess.
 */
export function sessionLinePriceId(line: Stripe.LineItem): string | null {
  return line.price?.id ?? null;
}

// ── resolveInvoice ──────────────────────────────────────────────────────────

/**
 * §5.3 — retrieve the invoice from Stripe and read everything from the RETRIEVED
 * object. The event payload is a notification, never the source of amounts (R6).
 *
 * `lines` is expanded in the retrieve so the price ids are present without a
 * second call. A paginated invoice with more than 100 lines would truncate; a
 * membership invoice has one line, and the catalog check below fails closed if a
 * line is ever missing rather than accruing on a partial read.
 */
export async function resolveInvoice(
  stripe: Stripe,
  invoiceId: string,
): Promise<ResolvedPayment> {
  const invoice = await stripe.invoices.retrieve(invoiceId, {
    expand: ['lines.data.pricing.price_details.price'],
  });

  const customer = invoice.customer;
  const customerId =
    customer == null ? null : typeof customer === 'string' ? customer : customer.id;

  const lines = invoice.lines?.data ?? [];

  return {
    ref: invoice.id as string,
    amountCents: invoice.amount_paid,
    customerId,
    periodMonth: utcFirstOfMonth(invoice.period_start),
    livemode: invoice.livemode,
    priceIds: lines.map(invoiceLinePriceId),
  };
}

// ── resolveOneTime ──────────────────────────────────────────────────────────

/**
 * §5.5 — a one-time payment (checkout.session.completed with mode 'payment').
 *
 * The ref is the PAYMENT INTENT id, and the period month is the UTC month of the
 * payment intent's `created`. §5.5 states this rule "here and nowhere else", so it
 * is implemented in exactly this function.
 *
 * The amount comes from the SESSION's amount_total, as the ticket specifies: the
 * session is what the buyer agreed to and what the line items belong to.
 */
export async function resolveOneTime(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<ResolvedPayment> {
  const pi = session.payment_intent;
  const piId = pi == null ? null : typeof pi === 'string' ? pi : pi.id;
  if (!piId) {
    throw new Error('rail: checkout session has no payment intent');
  }

  const intent = await stripe.paymentIntents.retrieve(piId);

  // The session's line items are not on the session object unless expanded, so
  // they are listed. One call, bounded by the SDK's own timeout.
  const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });

  return {
    ref: intent.id,
    amountCents: session.amount_total ?? 0,
    customerId:
      session.customer == null
        ? null
        : typeof session.customer === 'string'
          ? session.customer
          : session.customer.id,
    periodMonth: utcFirstOfMonth(intent.created),
    livemode: intent.livemode,
    priceIds: (items.data ?? []).map(sessionLinePriceId),
  };
}

// ── accrueForSource ─────────────────────────────────────────────────────────

/** §5.6 — the two rates, in basis points. No other rate exists in code (R11). */
const RATE_BPS_BY_LEVEL: Record<number, number> = { 1: 2000, 2: 1000 };

export interface AccrueInput {
  ref: string;
  amountCents: number;
  periodMonth: string;
  livemode: boolean;
  mode: StripeMode;
  priceIds: Array<string | null>;
  sourceAgentId: string;
}

/**
 * The whole accrual decision, in order, with one write at the end.
 *
 * R10 first: amount_paid <= 0 writes nothing. Trials and 100%-off vouchers arrive
 * as real paid invoices with a zero amount.
 *
 * R47 second: every line item's price must be a declared membership price for this
 * mode. A line with NO price id fails the check — §5.5a says "every line item's
 * price is in that list", so a mixed cart of one membership and one unpriced item
 * must not accrue. The caller records the stripe_webhook_failures row; this
 * function only decides.
 *
 * Then the chain, then integer amounts, then ONE rpc.
 */
export async function accrueForSource(
  deps: AccrualDeps,
  input: AccrueInput,
  buildChain: (agentId: string, db: AccrualDb) => Promise<Array<{ agentId: string; level: number }>>,
): Promise<AccrualOutcome> {
  // R10
  if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    return { kind: 'zero' };
  }

  // R47 — membership payments only, per mode.
  if (input.priceIds.length === 0) {
    return { kind: 'non_membership', reason: NON_MEMBERSHIP_REASON, priceIds: input.priceIds };
  }
  for (const id of input.priceIds) {
    if (!isMembershipPrice(id, input.mode)) {
      return { kind: 'non_membership', reason: NON_MEMBERSHIP_REASON, priceIds: input.priceIds };
    }
  }

  // §5.6 — the chain, reads only.
  const chain = await buildChain(input.sourceAgentId, deps.db);

  // R3, R4 — INTEGER CENTS, floor(source × rate_bps / 10000). The legacy engine
  // multiplied a float percentage (D5); 7900 * 0.2 is representable, but
  // 24900 * 0.1 is 2490.0000000000005 in IEEE 754, and a cent of drift in a
  // money row is a defect even when it rounds away on display.
  const rows: AccrualRow[] = [];
  for (const link of chain) {
    const rate = RATE_BPS_BY_LEVEL[link.level];
    if (!rate) continue; // levels beyond 2 never accrue (R11)
    rows.push({
      earning_agent_id: link.agentId,
      level: link.level,
      rate_bps: rate,
      amount_cents: Math.floor((input.amountCents * rate) / 10000),
    });
  }

  // §5.7, R7 — ONE call, and its error is CHECKED. In the R59 deploy gap
  // rail_accrue does not exist yet and this errors; the caller must turn that into
  // a non-2xx so Stripe retries. Swallowing it here would lose the payment.
  const { data, error } = await deps.db.rpc('rail_accrue', {
    p_invoice_ref: input.ref,
    p_source_agent: input.sourceAgentId,
    p_source_cents: input.amountCents,
    p_period_month: input.periodMonth,
    p_livemode: input.livemode,
    p_rows: rows,
  });

  if (error) {
    throw new Error(`rail_accrue failed: ${error.message ?? String(error)}`);
  }

  // rail_accrue returns the number of accrual rows written: 0 on a replay.
  const written = typeof data === 'number' ? data : Number(data ?? 0);
  if (written === 0 && rows.length > 0) {
    return { kind: 'replay' };
  }
  // An empty chain writes 0 accrual rows but still claims the invoice with a
  // revenue row, so it is 'written', not a replay. rail_accrue's own
  // ON CONFLICT on hive_revenue is what distinguishes the two.
  return { kind: 'written', rows };
}

// ── releaseClaim ────────────────────────────────────────────────────────────

/**
 * R14 — best-effort release of the event claim, so Stripe's retry is processed
 * rather than answered "already processed".
 *
 * Returns ok:false with the error rather than throwing: the caller has to decide
 * between "released, return 500 and let Stripe retry" and "could not release,
 * write a failures row and alert, then return 500". Throwing here would collapse
 * those two paths into one.
 */
export async function releaseClaim(
  db: AccrualDb,
  eventId: string,
): Promise<{ ok: true } | { ok: false; error: unknown }> {
  const { error } = await db.from('stripe_events').delete().eq('event_id', eventId);
  if (error) return { ok: false, error };
  return { ok: true };
}

// ── cancelMembership ────────────────────────────────────────────────────────

/**
 * L6, R17 — one function for both customer.subscription.deleted and
 * customer.subscription.updated → canceled/unpaid.
 *
 * A cancelled member stops earning (Bible v1.3, Sept 7 Decision 4). isActiveEarner
 * reads agents.status, so the cancellation must land on `agents` as well as
 * `members`; updating members alone left cancelled bees accruing
 * (NIK-WEBHOOK-001 FIND-WH-1). BOTH writes are error-checked and the caller turns
 * either error into a 500 so Stripe retries rather than accepting a silent miss.
 */
export async function cancelMembership(
  db: AccrualDb,
  subscriptionId: string,
): Promise<{ ok: true; agentIds: string[] } | { ok: false; stage: 'members' | 'agents'; error: unknown }> {
  const { data: cancelled, error: memberErr } = await db
    .from('members')
    .update({ status: 'inactive', subscription_expires_at: new Date().toISOString() })
    .eq('stripe_subscription_id', subscriptionId)
    .select('agent_id');

  if (memberErr) return { ok: false, stage: 'members', error: memberErr };

  const agentIds: string[] = (cancelled ?? [])
    .map((m: any) => m.agent_id)
    .filter(Boolean);

  if (agentIds.length === 0) {
    // No member row carried an agent id. Not an error: a subscription can exist
    // without a linked agent, and the caller logs it.
    return { ok: true, agentIds: [] };
  }

  const { error: agentErr } = await db
    .from('agents')
    .update({ status: 'inactive' })
    .in('id', agentIds);

  if (agentErr) return { ok: false, stage: 'agents', error: agentErr };
  return { ok: true, agentIds };
}
