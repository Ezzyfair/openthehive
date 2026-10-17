export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// §11 · the no-cache posture, the same four every bee route declares. A memoized
// balance read on a money route is the FIND-POLL-CACHE bug with money attached:
// railAdmin()'s cache:'no-store' is the first belt, these are the second.
export const fetchCache = 'force-no-store';
export const revalidate = 0;
import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { railStripe } from '@/lib/rail/stripe';
import { railAdmin } from '@/lib/rail/db';
import { claimEvent, handleStripeEvent, recordWebhookFailure } from '@/lib/rail/webhook-handler';

// ----------------------------------------------------------------------------
// THE HIVE · the platform Stripe webhook. RAIL-DESIGN-v1.1 §5. NIK-RAIL-004.
//
// This file now holds ONLY what a route can do and a test cannot: read the raw
// body, verify the Stripe signature over it, build the two clients, and hand the
// event to the dispatch. Every branch §5 describes — the invoice accrual, the
// checkout flow, cancellation, the failure rule — lives in
// lib/rail/webhook-handler.ts and is driven directly by the commit-4 self-test.
//
// WHY THE SPLIT. Row 4's gate is a "self-test against the real handler with
// stubbed Stripe". A POST handler cannot be called from a test: it wants a
// NextRequest, a signature computed over the exact bytes, and
// STRIPE_WEBHOOK_SECRET present. Testing a second copy of the dispatch would have
// proven nothing about the code that actually runs. The dispatch therefore takes
// its dependencies as arguments, and what remains here is three statements with no
// branching in them.
//
// The signature check is NOT an idempotency gate — a valid signature stays valid
// on every replay — which is why claimEvent runs immediately after it and before
// any work (R13).
// ----------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  // Lazy, per request: a preview builds without STRIPE_SECRET_KEY (§5.1).
  const stripe = railStripe();

  const body = await req.text();
  const sig = req.headers.get('stripe-signature');
  let event: Stripe.Event;
  try {
    // R12 · the signature is verified on the RAW body, before anything else.
    event = stripe.webhooks.constructEvent(
      body,
      sig as string,
      process.env.STRIPE_WEBHOOK_SECRET as string,
    );
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const supabase = railAdmin();

  // R13 · claim before any work. The row IS the claim: one INSERT against
  // stripe_events.event_id PRIMARY KEY, no read-before-write, because a SELECT
  // then an INSERT is itself a race under concurrent delivery.
  const claim = await claimEvent(supabase, event);

  if (claim.kind === 'duplicate') {
    // 200, not 409: Stripe reads any 2xx as delivered and stops retrying, and "I
    // have already done this" is a success rather than a client error.
    console.log('stripe webhook: already processed, skipping', {
      event_id: event.id,
      event_type: event.type,
    });
    return NextResponse.json({ received: true, already_processed: true }, { status: 200 });
  }

  if (claim.kind === 'unavailable') {
    // We cannot tell a new event from a replay — most likely 42P01, a migration
    // not yet run. Fail CLOSED: Stripe retries, which costs a retry. Failing open
    // double-pays, and a double accrual moves money.
    console.error('stripe webhook: event claim failed, refusing to process', {
      event_id: event.id,
      event_type: event.type,
      code: claim.code,
      message: claim.message,
    });
    // Best-effort record of the refusal, kept from the pre-RAIL-004 route. Likely
    // to fail too — if stripe_events is missing, stripe_webhook_failures probably
    // is as well — which is exactly why it is swallowed. No email: a claim failure
    // repeats on every Stripe retry, and an alert that fires on every retry is an
    // alert nobody reads.
    await recordWebhookFailure(supabase, {
      event_id: event.id,
      event_type: event.type,
      reason: 'claim_failed',
      detail: { code: claim.code, message: claim.message },
    });
    return NextResponse.json({ error: 'event claim unavailable' }, { status: 500 });
  }

  const result = await handleStripeEvent(
    { stripe, db: supabase, now: () => new Date() },
    event,
  );
  return NextResponse.json(result.body, { status: result.status });
}
