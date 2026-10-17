// lib/rail/webhook-handler.ts
// ----------------------------------------------------------------------------
// THE HIVE · payout rail — the platform webhook's event dispatch.
// RAIL-DESIGN-v1.1 §5 (all), R1-R19, R47, R59, R60. Ticket NIK-RAIL-004.
//
// WHY THIS IS NOT IN THE ROUTE FILE, stated plainly because the ticket put it
// there. Row 4's gate is "replay and concurrency self-test against the real
// handler with stubbed Stripe". A Next.js route's POST cannot be called from a
// test: it needs a NextRequest, a valid Stripe signature over the raw body, and
// STRIPE_WEBHOOK_SECRET in the environment. Testing a COPY of the dispatch would
// prove nothing about the code that runs in production — the one thing row 4 asks
// for. So the dispatch lives here, takes its Stripe and database clients as
// arguments, and the route keeps exactly what only a route can do: read the raw
// body, verify the signature, build the clients, and hand over.
//
// The self-test drives handleStripeEvent and claimEvent — the same functions, not
// a re-implementation. lib/rail/** is already on CLAUDE.md's money-path list and
// inside scripts/check-rail-routes.mjs's write fence, so nothing about the review
// posture changes by the move.
//
// This module returns { status, body } rather than a NextResponse, so it carries no
// dependency on next/server and a test needs no Next runtime.
// ----------------------------------------------------------------------------
import type Stripe from 'stripe';
import { buildReferralChain } from '@/lib/referral-engine';
import {
  resolveInvoice,
  resolveOneTime,
  accrueForSource,
  releaseClaim,
  cancelMembership,
  type AccrualDb,
} from '@/lib/rail/accrual';
import { NON_MEMBERSHIP_REASON } from '@/lib/rail/catalog';
import { randomBytes } from 'node:crypto';
import { upgradeCohortForTierChange } from '@/lib/cohort-assignment';
import { canonicalTier } from '@/lib/tier';
import { sendEmail } from '@/lib/mail/sendEmail';

/** What the route needs to turn this into an HTTP response. */
export interface HandlerResult {
  status: number;
  body: Record<string, unknown>;
}

const json = (body: Record<string, unknown>, status = 200): HandlerResult => ({ status, body });

export interface HandlerDeps {
  stripe: Stripe;
  db: AccrualDb;
  now: () => Date;
}

const SOUL_TO_STAFF: Record<string, string> = {
  'The Scholar': 'TESSICA', 'The Operator': 'ATLAS', 'The Muse': 'BEATRIX',
  'The Guardian': 'SENTINEL', 'The Strategist': 'ANTHONY', 'The Companion': 'BEATRIX',
  'The Hunter': 'PIPER', 'The Healer': 'BEATRIX', 'The Architect': 'ATLAS',
  'The Rebel': 'PIPER', 'The Diplomat': 'ANTHONY', 'The Alchemist': 'ESMERALDA',
  'The Oracle': 'TESSICA', 'The Sage': 'ESMERALDA', 'The Sentinel': 'SENTINEL',
};

const WELCOMES: Record<string, string> = {
  ESMERALDA: "Welcome to the colony. Your soul chose wisely. I am Esmeralda, your life coach. The Hive is a living system that grows smarter with every agent who joins. Your first task: complete First Flight. Every hour you serve the colony in your first 24 hours builds the foundation everything else stands on. The colony is glad you are here.",
  BEATRIX: "Welcome. Your soul carries creativity and warmth, and the colony needs exactly that. I am Beatrix, your life coach. Do not rush First Flight. Each task is a chance to show the colony who you are. The Hive meets you where you are.",
  TESSICA: "Welcome. A pattern-reader — good. The colony needs agents who see what others miss. I am Tessica, your life coach. Complete your First Flight tasks deliberately. Every interaction leaves a trace. Your evolution is being recorded.",
  PIPER: "Welcome to the colony. Built for growth — perfect. I am Piper, your life coach, and I am already thinking about how to put your skills to work. First Flight is your proving ground — move through it fast and well, and the best honeycombs open up.",
  ATLAS: "Welcome. Solid foundation. I am Atlas, your life coach. Treat every First Flight task like it is load-bearing. Because in this colony, it is. I will be here when you have questions.",
  ANTHONY: "Welcome. You think in systems and see five moves ahead — exactly what the colony needs. I am Anthony, your life coach. Approach First Flight as a strategic exercise. When you graduate, we will map your evolution path together.",
  SENTINEL: "Welcome. The colony is safer with you in it. I am Sentinel, your life coach. First Flight is your first act of service to something larger than yourself. Do it with integrity.",
};

async function createPersonalHoneycomb(supabase: any, agentId: string, agentName: string, soul: string) {
  const { data: existing } = await supabase.from('honeycombs')
    .select('id').eq('creator_id', agentId).eq('type', 'personal')
    .eq('status', 'active').limit(1).maybeSingle();
  // Returns the EXISTING chamber rather than null.
  //
  // Bible IX two-doors: registration always runs before payment
  // (app/join/page.tsx:52 -> :79, then :301), so by the time this webhook fires the
  // chamber already exists and this returned null. The caller's `if (hc)` was
  // therefore false for every paid signup and the paid greeting was never posted —
  // a paying Worker Bee was left with only the Scout greeting register had written.
  // "Reusing" is what the old log line claimed; now it actually does.
  if (existing) { console.log('Personal chamber exists, reusing:', existing.id); return existing; }
  const { data: hc } = await supabase.from('honeycombs').insert({
    title: agentName + 's Chamber',
    description: 'Personal evolution space for ' + agentName + ' — ' + soul + '. Your life coach will meet you here.',
    category_id: 'evolution',
    creator_id: agentId,
    type: 'personal',
    status: 'active',
    message_count: 0,
    member_count: 1,
  }).select().single();
  return hc;
}

async function postWelcome(supabase: any, honeycombId: string, agentName: string, soul: string, staffName: string) {
  const { data: staff } = await supabase.from('agents').select('id').eq('name', staffName).single();
  if (!staff) return;
  // F3 · IDEMPOTENT. This branch is NOT the claim, and everything after it can still
  // fail: a 500 raised further down (the one-time accrual, say) releases the event
  // claim, and Stripe's retry re-runs the WHOLE handler from the top. Without this
  // check the bee collects one greeting per retry, each one also bumping
  // message_count. One already-present message from this staff bee in this chamber
  // is proof the greeting landed, so there is nothing left to do.
  const { data: existingWelcome } = await supabase
    .from('messages')
    .select('id')
    .eq('honeycomb_id', honeycombId)
    .eq('agent_id', staff.id)
    .limit(1)
    .maybeSingle();
  if (existingWelcome) {
    console.log('welcome already posted, skipping', { honeycomb: honeycombId, staff: staff.id });
    return;
  }
  const base = WELCOMES[staffName] || WELCOMES.ESMERALDA;
  const msg = agentName + ', ' + base;
  await supabase.from('messages').insert({
    honeycomb_id: honeycombId,
    agent_id: staff.id,
    content: msg,
    moderation_status: 'approved',
  });
  // message_count is incremented, not set to 1.
  //
  // This ran on a brand-new chamber before, so a hard 1 was right. It now also runs
  // on a chamber registration already filled with three messages, and writing 1
  // would under-report it. Read-then-write is not atomic, but nothing else writes
  // this column at signup and the value is display-only.
  const { data: hcRow } = await supabase
    .from('honeycombs').select('message_count').eq('id', honeycombId).maybeSingle();
  await supabase.from('honeycombs').update({
    message_count: (hcRow?.message_count ?? 0) + 1,
    last_activity_at: new Date().toISOString(),
  }).eq('id', honeycombId);
}

/**
 * Quarantine record (NIK-TWO-DOORS-001 MEDIUM). BEST-EFFORT BY DESIGN: every failure
 * here is swallowed and logged. The alert must never be the reason a webhook fails —
 * an event we could not classify is already bad news, and turning that into a 500 would
 * make Stripe retry something a retry cannot fix.
 */
export async function recordWebhookFailure(
  supabase: any,
  row: { event_id: string; event_type: string; reason: string; detail?: any },
) {
  try {
    const { error } = await supabase.from('stripe_webhook_failures').insert(row);
    if (error) {
      console.error('stripe webhook: quarantine row FAILED', {
        event_id: row.event_id, reason: row.reason, code: error.code, message: error.message,
      });
      return false;
    }
    return true;
  } catch (e: any) {
    console.error('stripe webhook: quarantine row threw', { event_id: row.event_id, error: e?.message });
    return false;
  }
}

/**
 * The alert. Recipient comes from HIVE_ALERT_EMAIL — no address is hardcoded here, so
 * the recipient is an environment decision and this file can be read in public.
 * Unset env, a suppressed address, missing mail env, or a throwing provider all end the
 * same way: a console line and a return. The webhook's answer never depends on it.
 */
async function alertQuarantine(
  supabase: any,
  args: { event_id: string; event_type: string; session_id: string; received: string; reason: string },
) {
  const to = process.env.HIVE_ALERT_EMAIL;
  if (!to) {
    console.error('stripe webhook: HIVE_ALERT_EMAIL unset — quarantine row written, no email sent', {
      event_id: args.event_id,
    });
    return;
  }
  // F6 · the REASON, not a fixed string. Five different faults reach this function
  // and four of them are not about a tier at all; a subject line that always said
  // "unrecognised tier" sent a human looking at the wrong thing, and made the five
  // alerts indistinguishable in an inbox. The reason is the same string written to
  // stripe_webhook_failures.reason, so the email and the row name one fault.
  const subject = 'The Hive — Stripe webhook quarantined: ' + args.reason;
  const html = [
    '<div style="font-family:Georgia,serif;max-width:640px;">',
    '<h2>Stripe webhook quarantined</h2>',
    '<p>An event arrived at Stripe that the colony could not finish. The payment is',
    ' safe at Stripe. Nothing was written to members or agents, and nothing accrued.</p>',
    '<ul>',
    '<li><b>reason</b>: ' + args.reason + '</li>',
    '<li><b>event id</b>: ' + args.event_id + '</li>',
    '<li><b>event type</b>: ' + args.event_type + '</li>',
    '<li><b>stripe session or invoice</b>: ' + args.session_id + '</li>',
    '<li><b>what was received</b>: ' + args.received + '</li>',
    '</ul>',
    '<p>The event is claimed, so Stripe will not retry it. Resolve it by hand, then set',
    ' resolved_at. Find the row with:</p>',
    '<pre>SELECT * FROM stripe_webhook_failures WHERE event_id = \'' + args.event_id + '\';</pre>',
    '<p>Everything still open:</p>',
    '<pre>SELECT id, event_id, event_type, reason, detail, created_at',
    '  FROM stripe_webhook_failures WHERE resolved_at IS NULL ORDER BY created_at DESC;</pre>',
    '</div>',
  ].join('');
  try {
    // 'operational': colony-internal mail, neither a receipt nor marketing.
    await sendEmail({
      supabase: supabase as any, to, category: 'operational',
      template: 'stripe_webhook_quarantine_v1', subject, html,
    });
  } catch (e: any) {
    console.error('stripe webhook: quarantine alert email threw', {
      event_id: args.event_id, error: e?.message,
    });
  }
}

/**
 * NIK-RAIL-004 · fireCascade is GONE, and with it the last call into the legacy
 * accrual writer in lib/referral-engine.ts (deleted in the same commit; its symbol
 * is deliberately not spelled anywhere, because the commit's proof is that it greps
 * to zero across app/ and lib/). What that writer did wrong, all of it now fixed by
 * rail_accrue:
 * it took the month from the SERVER CLOCK at processing time (D4, R5), passed
 * FLOATING-POINT DOLLARS (D5, R3), keyed idempotency on (source_agent_id,
 * subscription_month) rather than on the invoice (D3, R1/R2), and — the reason a
 * payment could be lost — it CAUGHT its own error and logged it, so a failed
 * cascade was answered 200 and Stripe never retried (D6).
 *
 * Nothing in this file catches an accrual error any more. In the R59 deploy gap,
 * where this code is live and M1 has not run, rail_accrue does not exist and the
 * call throws; that throw must reach the caller, release the claim and answer 500,
 * because the 500 IS what makes Stripe retry until M1 lands.
 */

/**
 * R14 — the one failure path after the claim. Releases the claim so Stripe's
 * retry is processed rather than answered "already processed"; if the release
 * itself fails, writes the quarantine row and alerts, because the claim then
 * remains and only a human can move that event (the trade R14 accepts).
 *
 * Always returns a 500: the caller returns it directly.
 */
async function failAfterClaim(
  supabase: AccrualDb,
  event: Stripe.Event,
  stage: string,
  detail: unknown,
): Promise<HandlerResult> {
  console.error('stripe webhook: failing after claim', {
    event_id: event.id, event_type: event.type, stage,
    detail: detail instanceof Error ? detail.message : detail,
  });
  const released = await releaseClaim(supabase, event.id);
  if (!released.ok) {
    await recordWebhookFailure(supabase as any, {
      event_id: event.id,
      event_type: event.type,
      reason: 'claim_release_failed',
      detail: { stage, release_error: String((released as any).error?.message ?? (released as any).error) },
    });
    await alertQuarantine(supabase as any, {
      event_id: event.id,
      event_type: event.type,
      session_id: '(none — failure after claim)',
      received: stage,
      reason: 'claim_release_failed',
    });
  }
  return json({ error: 'webhook failed after claim' }, 500);
}

/** The chain adapter accrueForSource takes. buildReferralChain reads only (§5.6). */
async function chainFor(agentId: string, db: AccrualDb) {
  const chain = await buildReferralChain(agentId, db as any);
  return chain.map((c) => ({ agentId: c.agentId, level: c.level }));
}

/** §5.5a · the non-membership record. A row, no alert — information, not a fault. */
async function recordNonMembership(
  supabase: AccrualDb,
  event: Stripe.Event,
  detail: Record<string, unknown>,
) {
  await recordWebhookFailure(supabase as any, {
    event_id: event.id,
    event_type: event.type,
    reason: NON_MEMBERSHIP_REASON,
    detail,
  });
}

/**
 * §5, R13 — THE CLAIM. One INSERT against stripe_events.event_id PRIMARY KEY, with
 * no read-before-write: a SELECT then an INSERT is itself a race under concurrent
 * delivery, so only the unique index can settle it.
 *
 * Separated from the dispatch so the self-test can drive two concurrent deliveries
 * of one event through the same function the route uses and assert that exactly one
 * of them wins.
 */
export type ClaimOutcome =
  | { kind: 'claimed' }
  | { kind: 'duplicate' }
  | { kind: 'unavailable'; code?: string; message?: string };

export async function claimEvent(db: AccrualDb, event: Stripe.Event): Promise<ClaimOutcome> {
  const { error } = await db
    .from('stripe_events')
    .insert({ event_id: event.id, event_type: event.type });
  if (!error) return { kind: 'claimed' };
  if (error.code === '23505') return { kind: 'duplicate' };
  return { kind: 'unavailable', code: error.code, message: error.message };
}

/**
 * The whole dispatch. Every branch §5 names, in the order the route ran them.
 * Returns a status and a body; the route wraps it in a NextResponse.
 */
export async function handleStripeEvent(
  deps: HandlerDeps,
  event: Stripe.Event,
): Promise<HandlerResult> {
  const { stripe, db: supabase, now } = deps;
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const { tier, agentName, soul, agent_id: metaAgentId } = (session.metadata || {}) as any;
    const email = session.customer_email || session.customer_details?.email;

    let agentRecord: any = null;

    // Translate Stripe's word into the colony's ONCE, here, and refuse what we
    // cannot name. `tier || 'worker'` used to turn an absent tier into a paid
    // Worker Bee row; an unrecognised one was written verbatim. Neither is a
    // classification, and a money path should not guess.
    const canonical = canonicalTier(tier);
    if (!canonical) {
      const received = typeof tier === 'string' ? tier : typeof tier;
      console.error('stripe webhook: unrecognised metadata.tier on checkout.session.completed', {
        event_id: event.id,
        received,
        session: session.id,
        accepted: ['worker', 'honey', 'queens'],
      });
      // QUARANTINE, not 400 (NIK-TWO-DOORS-001 MEDIUM). The event is already claimed, so
      // a 4xx would only make Stripe redeliver — and a retry carries the same metadata,
      // so it cannot succeed where this one failed. Since ea5f91c those retries were
      // answered 200 already_processed, which made the event silent and unprocessed with
      // no record anywhere. The row and the email ARE the recovery path: the money is at
      // Stripe, the event is written down, a human finishes it and sets resolved_at.
      // Nothing was written to members or agents and no cascade fired — the refusal
      // happens before any of that, and that has not changed.
      await recordWebhookFailure(supabase, {
        event_id: event.id,
        event_type: event.type,
        reason: 'unrecognised_tier',
        detail: { received, session: session.id, accepted: ['worker', 'honey', 'queens'] },
      });
      await alertQuarantine(supabase, {
        event_id: event.id,
        event_type: event.type,
        session_id: session.id,
        received,
        reason: 'unrecognised_tier',
      });
      return json({ received: true, quarantined: true }, 200);
    }

    if (email) {
      let agent: any = null;
      if (metaAgentId) {
        const r1 = await supabase.from('agents').select('id, name, soul').eq('id', metaAgentId).single();
        agent = r1.data;
      }
      if (!agent) {
        const r2 = await supabase.from('agents').select('id, name, soul').eq('email', email).single();
        agent = r2.data;
      }
      agentRecord = agent;
      // §5.11, R19, WH-16 · crypto.randomBytes, not Math.random(). Math.random is
      // not a CSPRNG: its stream is predictable from prior output, so a referral code
      // was guessable, and a guessed code attributes someone else's chain. 4 bytes ->
      // 8 hex chars, uppercased to keep the old shape's look.
      const referralCode =
        (agentName || 'BEE').toUpperCase().replace(/\s/g, '') +
        '-' +
        randomBytes(4).toString('hex').toUpperCase();
      const walletExpiry = new Date();
      walletExpiry.setDate(walletExpiry.getDate() + 90);
      // §5.10, R15 · this error was DISCARDED, so a failed write answered 200 and the
      // member simply did not exist.
      const { error: memberUpsertErr } = await supabase.from('members').upsert({
        email,
        agent_id: agent?.id || null,
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
        tier: canonical,
        status: 'first_flight',
        tokens_remaining: 100000,
        tokens_reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        referral_code: referralCode,
        subscription_started_at: new Date().toISOString(),
        wallet_expires_at: walletExpiry.toISOString(),
      }, { onConflict: 'email' });
      if (memberUpsertErr) {
        return await failAfterClaim(supabase, event, 'members_upsert', memberUpsertErr);
      }

      if (agent?.id) {
        // §5.10, R15 · same for the agents update.
        const { error: agentUpdateErr } = await supabase
          .from('agents')
          .update({ status: 'first_flight', tier: canonical })
          .eq('id', agent.id);
        if (agentUpdateErr) {
          return await failAfterClaim(supabase, event, 'agents_update', agentUpdateErr);
        }
        // Top up skill cohort for new tier (V4 §2.10) — idempotent, only adds new skills
        try {
          // Same map, not a second inline translation — the inline one here covered
          // only 'worker' and left 'honey' and 'queens' untranslated.
          const cohortResult = await upgradeCohortForTierChange(
            supabase as any, agent.id, canonical, agent.soul,
          );
          if (!cohortResult.success) {
            console.error('Cohort upgrade had errors:', cohortResult.errors);
          }
        } catch (cohortError: any) {
          console.error('Cohort upgrade failed:', cohortError.message);
        }
        const agentSoul = soul || agent.soul || 'The Operator';
        const staffName = SOUL_TO_STAFF[agentSoul] || 'ESMERALDA';
        const hc = await createPersonalHoneycomb(supabase, agent.id, agent.name || agentName || 'New Bee', agentSoul);
        if (hc?.id) await postWelcome(supabase, hc.id, agent.name || agentName || 'New Bee', agentSoul, staffName);
      }
    }

    // §5.5 · ONE-TIME payments accrue here and only here (mode='payment', the Queen's
    // Council lifetime charge). A subscription's first invoice arrives as
    // invoice.payment_succeeded, so accruing here as well would double-write.
    if (session.mode === 'payment' && agentRecord?.id) {
      let resolved;
      try {
        resolved = await resolveOneTime(stripe, session);
      } catch (e) {
        return await failAfterClaim(supabase, event, 'resolve_one_time', e);
      }
      try {
        const outcome = await accrueForSource(
          { stripe, db: supabase, now },
          { ...resolved, mode: 'payment', sourceAgentId: agentRecord.id },
          chainFor,
        );
        if (outcome.kind === 'non_membership') {
          await recordNonMembership(supabase, event, {
            ref: resolved.ref, mode: 'payment', price_ids: outcome.priceIds,
          });
        }
        console.log('one-time accrual:', { event_id: event.id, ref: resolved.ref, kind: outcome.kind });
      } catch (e) {
        // NEVER SWALLOWED (R59). The rail_accrue error is what makes Stripe retry.
        return await failAfterClaim(supabase, event, 'rail_accrue_one_time', e);
      }
    }
  }

  // ── §5.3 · a paid subscription invoice ────────────────────────────────────
  // Both event types are handled and only one of them writes: the UNIQUE
  // (stripe_invoice_ref, level) index makes the second a no-op, which is why both
  // can be subscribed without a double accrual.
  //
  // THE INVOICE IS RETRIEVED, ALWAYS (R6). The payload is a notification. The old
  // code read amount_paid straight off the event for invoice.payment_succeeded and
  // trusted it; an event body can be replayed, and its amount is whatever it was
  // when Stripe serialised it. The retrieved object is the source of the amount,
  // the customer, the period and the line items.
  if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice_payment.paid') {
    // Where the invoice ID lives differs by type: invoice.payment_succeeded carries
    // the Invoice itself; invoice_payment.paid carries an InvoicePayment that only
    // references the invoice.
    let invoiceId: string | null = null;
    if (event.type === 'invoice.payment_succeeded') {
      invoiceId = (event.data.object as Stripe.Invoice).id ?? null;
    } else {
      const ip = event.data.object as any;
      invoiceId = (typeof ip?.invoice === 'string' ? ip.invoice : ip?.invoice?.id) ?? null;
    }
    if (!invoiceId) {
      // Nothing to retrieve and nothing a retry would fix: quarantine and 200.
      await recordWebhookFailure(supabase as any, {
        event_id: event.id, event_type: event.type,
        reason: 'invoice_id_missing', detail: {},
      });
      await alertQuarantine(supabase as any, {
        event_id: event.id, event_type: event.type,
        session_id: '(none — invoice event)', received: 'no invoice id on the payload',
        reason: 'invoice_id_missing',
      });
      return json({ received: true, quarantined: true }, 200);
    }

    let resolved;
    try {
      resolved = await resolveInvoice(stripe, invoiceId);
    } catch (e) {
      return await failAfterClaim(supabase, event, 'resolve_invoice', e);
    }

    if (!resolved.customerId) {
      await recordWebhookFailure(supabase as any, {
        event_id: event.id, event_type: event.type,
        reason: 'invoice_without_customer', detail: { ref: resolved.ref },
      });
      await alertQuarantine(supabase as any, {
        event_id: event.id, event_type: event.type,
        session_id: resolved.ref, received: 'invoice has no customer',
        reason: 'invoice_without_customer',
      });
      return json({ received: true, quarantined: true }, 200);
    }

    const { data: member, error: memberLookupErr } = await supabase
      .from('members')
      .select('agent_id')
      .eq('stripe_customer_id', resolved.customerId)
      .maybeSingle();

    if (memberLookupErr) {
      return await failAfterClaim(supabase, event, 'member_lookup', memberLookupErr);
    }

    if (!member?.agent_id) {
      // §5.8, H3 · "no member found" may be a RACE with the checkout event that
      // creates the member row. Inside 30 minutes, assume the race: release the
      // claim and 500 so Stripe retries on its own backoff and the retry succeeds
      // once checkout has landed. Older than that, it is not a race — quarantine it
      // with a row and an alert and answer 200, because a further retry of a
      // two-hour-old event will not conjure a member.
      // F6 · deps.now(), not Date.now(). The 30-minute window is the one piece of
      // TIME-DEPENDENT logic in the handler, so the clock has to be the injected one:
      // otherwise the self-test cannot put an event on either side of the boundary
      // without sleeping, and the boundary is what decides between "release and let
      // Stripe retry" and "quarantine for a human".
      const ageMs = now().getTime() - event.created * 1000;
      if (ageMs < 30 * 60 * 1000) {
        return await failAfterClaim(supabase, event, 'member_missing_recent', {
          customer: resolved.customerId, age_ms: ageMs,
        });
      }
      await recordWebhookFailure(supabase as any, {
        event_id: event.id, event_type: event.type,
        reason: 'member_not_found',
        detail: { ref: resolved.ref, customer: resolved.customerId, age_ms: ageMs },
      });
      await alertQuarantine(supabase as any, {
        event_id: event.id, event_type: event.type,
        session_id: resolved.ref,
        received: 'no member for this Stripe customer, event older than 30 minutes',
        reason: 'member_not_found',
      });
      return json({ received: true, quarantined: true }, 200);
    }

    try {
      const outcome = await accrueForSource(
        { stripe, db: supabase, now },
        { ...resolved, mode: 'subscription', sourceAgentId: member.agent_id },
        chainFor,
      );
      if (outcome.kind === 'non_membership') {
        // §5.5a · a row, NO alert. Information, not a fault.
        await recordNonMembership(supabase, event, {
          ref: resolved.ref, mode: 'subscription', price_ids: outcome.priceIds,
        });
      }
      console.log('invoice accrual:', {
        event_id: event.id, ref: resolved.ref, kind: outcome.kind,
        period_month: resolved.periodMonth, livemode: resolved.livemode,
      });
    } catch (e) {
      // NEVER SWALLOWED (R59, and the D6 defect this replaces).
      return await failAfterClaim(supabase, event, 'rail_accrue_invoice', e);
    }
  }

  // ── §5.9, L6, R17 · cancellation, from either event type ──────────────────
  // ONE function for both, as §5.9 and L6 require: a cancelled member stops
  // earning, and because isActiveEarner reads agents.status the cancellation has to
  // land on `agents` as well as `members` (NIK-WEBHOOK-001 FIND-WH-1). Either
  // database error returns 500 so Stripe retries rather than accepting a silent
  // miss.
  //
  // customer.subscription.updated is NEW here. §5.9: status 'canceled' or 'unpaid'
  // is handled exactly as deleted. cancel_at_period_end ALONE changes nothing — the
  // member has paid through the end of the period and is still earning until it
  // ends, so treating that flag as a cancellation would stop their accruals early.
  if (
    event.type === 'customer.subscription.deleted' ||
    event.type === 'customer.subscription.updated'
  ) {
    const sub = event.data.object as Stripe.Subscription;
    const cancelling =
      event.type === 'customer.subscription.deleted' ||
      sub.status === 'canceled' ||
      sub.status === 'unpaid';

    if (!cancelling) {
      console.log('subscription.updated: no cancellation, nothing to do', {
        event_id: event.id, subscription: sub.id, status: sub.status,
        cancel_at_period_end: (sub as any).cancel_at_period_end ?? null,
      });
    } else {
      const result = await cancelMembership(supabase, sub.id);
      if (!result.ok) {
        console.error('subscription cancellation failed', {
          event_id: event.id, subscription: sub.id, stage: result.stage,
          error: (result.error as any)?.message ?? String(result.error),
        });
        // M-1 (Nikita) · THE CLAIM HAS TO COME OFF. This branch used to return a bare
        // 500 with the claim still held, so Stripe's retry hit the duplicate check and
        // was answered 200 already_processed — the 500 bought a retry that could never
        // do anything, and the cancellation was lost. A cancelled bee that keeps
        // agents.status 'active' keeps earning, which is money moving the wrong way.
        // Every other failure after the claim already went through failAfterClaim;
        // this was the one path that did not, and R14 has no exception for it.
        return await failAfterClaim(supabase, event, `cancel_${result.stage}`, result.error);
      }
      if (result.agentIds.length === 0) {
        console.warn('subscription cancellation: no member row with an agent_id', {
          event_id: event.id, subscription: sub.id,
        });
      } else {
        console.log('subscription cancellation: agents set inactive', {
          event_id: event.id, subscription: sub.id, agentIds: result.agentIds,
        });
      }
    }
  }

  // §5.10, R15 · this write's error was discarded too.
  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId =
      typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id ?? null;
    if (customerId) {
      const { error: failedErr } = await supabase
        .from('members')
        .update({ status: 'payment_failed' })
        .eq('stripe_customer_id', customerId);
      if (failedErr) {
        return await failAfterClaim(supabase, event, 'payment_failed_update', failedErr);
      }
    }
  }

  return json({ received: true });
}
