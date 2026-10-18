// lib/rail/reversal.ts
// ----------------------------------------------------------------------------
// THE HIVE · payout rail — reversal: what a refund or a dispute does to accruals.
// RAIL-DESIGN-v1.1 §6, §5.8, §15 row 5 · R12-R16, R33-R35, R60. Ticket NIK-RAIL-005.
//
// Pure, like lib/rail/accrual.ts: the Stripe client and the database arrive as
// arguments, nothing here reads env or builds a client, and the self-test drives
// these exact functions rather than a copy of them.
//
// THE ONE HARD PROBLEM THIS FILE SOLVES. Every accrual the rail writes is keyed on
// an invoice ref — or, for a one-time payment, on a payment-intent id (§5.5). A
// refund arrives as charge.refunded carrying a Charge, and A CHARGE HAS NO invoice
// FIELD in the pinned api version (2026-03-25.dahlia): measured in
// NIK-RAIL-005's measure, `grep -c -i invoice Charges.d.ts` = 1 and that one hit is
// prose in a doc comment. So the ref has to be RECOVERED, and resolveRef below is
// the whole of how.
//
// WHAT IS NOT HERE, deliberately: no write to referral_earnings. Ruling R-H (Oct 18)
// puts the reversal in a fourth SECURITY DEFINER function, rail_reverse, so no code
// under app/ or lib/ touches the money tables directly and the guard's RULE C stays
// at zero exemptions. This file decides WHICH ref and WHICH reason; the database
// decides what that means for the rows.
// ----------------------------------------------------------------------------
import type Stripe from 'stripe';
import type { AccrualDb } from './accrual';

/** §6 — the two reasons rail_reverse accepts. Nothing else is a reversal. */
export type ReversalReason = 'refund' | 'dispute';

/**
 * What rail_reverse answers. `known` is "did the rail ever accrue on this ref in
 * this mode" (the hive_revenue row is the claim, F1); `reversed` is how many pending
 * rows moved; `untouched` is how many had already left as in_transit or paid.
 */
export interface ReversalResult {
  known: boolean;
  reversed: number;
  untouched: number;
}

/** resolveRef either finds the ref or says, in one word, why it could not. */
export type RefOutcome =
  | { ref: string }
  | { unresolved: 'no_payment_intent' | 'no_invoice_and_no_intent' };

/**
 * §6 — from a payment intent id to the ref the rail keyed its accruals on.
 *
 * TWO CASES, and the order matters:
 *   1. A SUBSCRIPTION charge. The intent paid an invoice, so invoicePayments.list
 *      finds it and the ref is that invoice id ('in_...'), which is what
 *      resolveInvoice wrote.
 *   2. A ONE-TIME charge (the Queen's Council payment). There is no invoice; §5.5
 *      makes the payment-intent id itself the ref ('pi_...'), which is what
 *      resolveOneTime wrote. An empty list IS that case — it is not a failure.
 *
 * A THROWN STRIPE ERROR IS NOT AN UNRESOLVED REF. It propagates, and the caller
 * turns it into failAfterClaim: 500, claim released, Stripe retries. The difference
 * matters — 'unresolved' means "we looked and the answer is nothing a retry would
 * change", while a network error means "ask again".
 *
 * The SDK shapes this relies on, measured in the installed tree (22.0.1):
 *   InvoicePayments.d.ts:12   list(params?: InvoicePaymentListParams, …):
 *                             ApiListPromise<InvoicePayment>
 *   InvoicePayments.d.ts:117  payment?: InvoicePaymentListParams.Payment
 *   InvoicePayments.d.ts:124  Payment { payment_intent?: string; type: Payment.Type }
 *                             — `type` is REQUIRED, hence it is passed below
 *   InvoicePayments.d.ts:46   invoice: string | Invoice | DeletedInvoice
 *                             — a THREE-member union; the ticket named two. Reading
 *                             the id by narrowing on typeof is total over all three
 *                             (DeletedInvoice carries an id, Invoices.d.ts:437).
 */
export async function resolveRef(
  stripe: Stripe,
  args: { paymentIntentId: string | null },
): Promise<RefOutcome> {
  if (!args.paymentIntentId) return { unresolved: 'no_payment_intent' };

  const payments = await stripe.invoicePayments.list({
    payment: { type: 'payment_intent', payment_intent: args.paymentIntentId },
    limit: 1,
  });

  const first = payments.data?.[0];
  if (!first) {
    // §5.5: no invoice behind this payment, so the intent IS the ref.
    return { ref: args.paymentIntentId };
  }

  const invoice = first.invoice;
  const invoiceId = typeof invoice === 'string' ? invoice : invoice?.id ?? null;
  if (!invoiceId) {
    // An invoice payment that names no invoice should not exist. Fail closed rather
    // than quietly reversing against the intent, which could be a DIFFERENT ref from
    // the one the accrual used — and reversing the wrong ref is worse than reversing
    // nothing, because it moves money that was never refunded.
    return { unresolved: 'no_invoice_and_no_intent' };
  }
  return { ref: invoiceId };
}

/**
 * The payment intent id a Charge points at, as a string or nothing.
 * Charges.d.ts:161 — `payment_intent: string | PaymentIntent | null`.
 */
export function chargePaymentIntentId(charge: Stripe.Charge): string | null {
  const pi = charge.payment_intent;
  if (pi == null) return null;
  return typeof pi === 'string' ? pi : pi.id ?? null;
}

/**
 * The same for a Dispute, which models it differently:
 * Disputes.d.ts:84 — `payment_intent: string | PaymentIntent | null` (nullable), and
 * Disputes.d.ts:50 — `charge: string | Charge` (NOT nullable). So a dispute always
 * names a charge and only usually names an intent, which is why disputeIntent below
 * may have to fetch the charge.
 */
export function disputePaymentIntentId(dispute: Stripe.Dispute): string | null {
  const pi = dispute.payment_intent;
  if (pi == null) return null;
  return typeof pi === 'string' ? pi : pi.id ?? null;
}

/** The charge id a Dispute names. Never null per the type, but read defensively. */
export function disputeChargeId(dispute: Stripe.Dispute): string | null {
  const c = dispute.charge;
  if (c == null) return null;
  return typeof c === 'string' ? c : c.id ?? null;
}

/**
 * §6 — the payment intent behind a dispute, fetching the charge only if the dispute
 * did not carry one. One retrieve at most, and a throw from it is a retry signal, not
 * an unresolved ref (see resolveRef).
 */
export async function disputeIntent(
  stripe: Stripe,
  dispute: Stripe.Dispute,
): Promise<string | null> {
  const direct = disputePaymentIntentId(dispute);
  if (direct) return direct;

  const chargeId = disputeChargeId(dispute);
  if (!chargeId) return null;

  const charge = await stripe.charges.retrieve(chargeId);
  return chargePaymentIntentId(charge);
}

/**
 * §6, R60 — the ONE call that writes. Its error is returned, not swallowed and not
 * thrown: the caller has to turn it into failAfterClaim, and a thrown error would
 * make that indistinguishable from a Stripe failure at the call site.
 *
 * rail_reverse RETURNS TABLE, so supabase-js hands back an array of one row.
 */
export async function reverseForRef(
  db: AccrualDb,
  args: { ref: string; reason: ReversalReason; livemode: boolean },
): Promise<{ ok: true; result: ReversalResult } | { ok: false; error: unknown }> {
  const { data, error } = await db.rpc('rail_reverse', {
    p_invoice_ref: args.ref,
    p_reason: args.reason,
    p_livemode: args.livemode,
  });

  if (error) return { ok: false, error };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    // A function that returned no row at all is a contract break, not a result.
    return { ok: false, error: new Error('rail_reverse returned no row') };
  }

  return {
    ok: true,
    result: {
      known: row.known === true,
      reversed: Number(row.reversed ?? 0),
      untouched: Number(row.untouched ?? 0),
    },
  };
}

/** §6 ruling 6, R35 — the reason strings this commit adds. No migration needed. */
export const REVERSAL_UNRESOLVED_REASON = 'reversal_unresolved';
export const REFUND_AFTER_PAYOUT_REASON = 'refund_after_payout';
