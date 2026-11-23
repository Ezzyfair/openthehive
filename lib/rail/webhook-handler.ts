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
import {
  resolveRef,
  disputeIntent,
  chargePaymentIntentId,
  disputeChargeId,
  reverseForRef,
  REVERSAL_UNRESOLVED_REASON,
  REFUND_AFTER_PAYOUT_REASON,
  type ReversalReason,
} from '@/lib/rail/reversal';
import { randomBytes } from 'node:crypto';
import { upgradeCohortForTierChange } from '@/lib/cohort-assignment';
import { canonicalTier, tierRank } from '@/lib/tier';
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
 *
 * F4 · THIS FUNCTION CANNOT THROW, and that is now load-bearing rather than merely
 * true. Every statement is an env read, string concatenation, or inside the try/catch
 * around sendEmail — there is no path out of here but a normal return. That matters
 * most for the reversal's refund_after_payout caller, which alerts AFTER a successful
 * reversal: a throw there would become a 500, Stripe would retry, and the retry would
 * find the rows already reversed — an alert failure turning into a retry loop over
 * work that already succeeded. The Sept 22 rule (the alert never takes the webhook
 * down) is what forbids that, so no caller wraps this and none needs to.
 */
async function alertQuarantine(
  supabase: any,
  args: {
    event_id: string;
    event_type: string;
    session_id: string;
    received: string;
    reason: string;
    /** F4 · what session_id actually IS for this caller. The reversal passes an
     *  invoice or payment-intent ref, which is not a checkout session, and a label
     *  that says otherwise sends a human to the wrong page at Stripe. */
    id_label?: string;
  },
) {
  // MEMBER-UPSERT-001 item 7 · one message per address in HIVE_ALERT_EMAIL.
  const recipients = alertRecipients();
  if (recipients.length === 0) {
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
    '<li><b>' + (args.id_label ?? 'stripe session or invoice') + '</b>: ' + args.session_id + '</li>',
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
  for (const to of recipients) {
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
}

/**
 * MEMBER-UPSERT-001 item 7 · the alert addresses, from the one variable that exists.
 * HIVE_ALERT_EMAIL split on commas, each part trimmed, empty parts dropped. One
 * address behaves exactly as before; unset or blank gives an empty list. No address
 * is written in this file.
 */
export function alertRecipients(): string[] {
  const raw = process.env.HIVE_ALERT_EMAIL;
  if (!raw) return [];
  return raw.split(',').map((s) => s.trim()).filter((s) => s !== '');
}

/** MEMBER-UPSERT-001 item 5 · the reason of the open to-do row an upgrade leaves. */
export const OLD_SUBSCRIPTION_OPEN_REASON = 'upgrade_old_subscription_open';

/**
 * MEMBER-UPSERT-001 item 6 · a member moved up a tier while an earlier subscription
 * is still running at Stripe. Same shape and same promise as alertQuarantine: THIS
 * FUNCTION CANNOT THROW (see F4 above). Every statement is an env read, string work,
 * or inside the try/catch around sendEmail, so it runs after a successful member
 * update without any way to turn that success into a 500 and a retry.
 *
 * The subject and the first paragraph are Francis's wording of Nov 22, word for word.
 * No money figure appears in the message.
 */
export async function alertOldSubscriptionOpen(
  supabase: any,
  args: {
    event_id: string;
    member: string;
    old_subscription: string;
    old_customer: string | null;
    new_subscription: string | null;
    held: string | null;
    bought: string;
    since: string;
  },
) {
  const recipients = alertRecipients();
  if (recipients.length === 0) {
    console.error('stripe webhook: HIVE_ALERT_EMAIL unset — open subscription row written, no email sent', {
      event_id: args.event_id,
    });
    return;
  }
  const subject = 'CANCEL AN EARLIER SUBSCRIPTION BY HAND';
  const html = [
    '<div style="font-family:Georgia,serif;max-width:640px;">',
    '<p>A member moved up a tier. The membership now rests on the new purchase and the member\'s record is right. The earlier subscription below is still running at Stripe and will bill the member again. Please cancel it in Stripe. This message repeats every hour until it is cancelled.</p>',
    '<ul>',
    '<li><b>member row id</b>: ' + args.member + '</li>',
    '<li><b>earlier subscription id</b>: ' + args.old_subscription + '</li>',
    '<li><b>earlier customer id</b>: ' + (args.old_customer ?? 'none') + '</li>',
    '<li><b>new subscription id</b>: ' + (args.new_subscription ?? 'none') + '</li>',
    '<li><b>held</b>: ' + (args.held ?? 'none') + '</li>',
    '<li><b>bought</b>: ' + args.bought + '</li>',
    '<li><b>open since</b>: ' + args.since + '</li>',
    '</ul>',
    '<p>Find the row with:</p>',
    '<pre>SELECT id, event_id, reason, detail, created_at FROM stripe_webhook_failures',
    ' WHERE event_id = \'' + args.event_id + '\' AND reason = \'' + OLD_SUBSCRIPTION_OPEN_REASON + '\';</pre>',
    '<p>When the earlier subscription is cancelled, close it by hand:</p>',
    '<pre>UPDATE stripe_webhook_failures SET resolved_at = now() WHERE id = \'(the id from the row above)\';</pre>',
    '</div>',
  ].join('');
  for (const to of recipients) {
    try {
      await sendEmail({
        supabase: supabase as any, to, category: 'operational',
        template: 'upgrade_old_subscription_open_v1', subject, html,
      });
    } catch (e: any) {
      console.error('stripe webhook: open subscription alert email threw', {
        event_id: args.event_id, error: e?.message,
      });
    }
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
 * MEMBER-UPSERT-001 item 2 · the members row for a checkout email, read before any
 * write. Its column list lives here, above handleStripeEvent, so the branch head (from
 * the branch start to the first members upsert) still names no agent column. Returns
 * the row or null, and the error when the read failed.
 */
async function readMemberByEmail(
  supabase: AccrualDb,
  email: string,
): Promise<{ row: any | null; error: any | null }> {
  const { data, error } = await supabase
    .from('members')
    .select('id, tier, status, agent_id, stripe_customer_id, stripe_subscription_id')
    .eq('email', email)
    .limit(1)
    .maybeSingle();
  if (error) return { row: null, error };
  return { row: data ?? null, error: null };
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
    const { tier, agentName, soul } = (session.metadata || {}) as any;
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
      // The bee is resolved by the checkout email. STRIPE-CHECKOUT-002 removed the metadata id on Nov 18, 2026, because a caller could choose it.
      const r2 = await supabase.from('agents').select('id, name, soul').eq('email', email).single();
      agent = r2.data;
      agentRecord = agent;
      // MEMBER-UPSERT-001 item 3 · read the row first, then decide which of five
      // cases this checkout is. Registration makes a row for every human before any
      // payment, so "the row exists" is not "second checkout": the test is whether
      // the row already holds a Stripe customer id. First match wins.
      const memberRead = await readMemberByEmail(supabase, email);
      if (memberRead.error) {
        return await failAfterClaim(supabase, event, 'member_read', memberRead.error);
      }
      const member = memberRead.row;
      const idOrNull = (v: unknown): string | null => {
        if (v == null) return null;
        const s = typeof v === 'string' ? v : typeof (v as any).id === 'string' ? (v as any).id : null;
        return s && s !== '' ? s : null;
      };
      const sessionCustomer = idOrNull(session.customer);
      const sessionSubscription = idOrNull(session.subscription);
      const heldCustomer = idOrNull(member?.stripe_customer_id);
      const heldSubscription = idOrNull(member?.stripe_subscription_id);
      // Copied now: the record and the alert name the tier held BEFORE any update.
      const heldTier: string | null = member?.tier ?? null;
      const memberCase: 'first' | 'retry' | 'returning' | 'upgrade' | 'not_upgrade' =
        !member || !heldCustomer ? 'first'
          : heldCustomer === sessionCustomer && heldSubscription === sessionSubscription ? 'retry'
            : member.status === 'inactive' ? 'returning'
              : tierRank(canonical) > tierRank(member.tier) ? 'upgrade'
                : 'not_upgrade';
      // FIRST (ruling 11): exactly what this branch wrote before. The lines of this
      // arm are kept byte for byte as on 4963408, so they are deliberately NOT
      // re-indented under the if.
      if (memberCase === 'first') {
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
      } else if (memberCase === 'returning' || memberCase === 'not_upgrade') {
        // RETURNING (ruling 10) and NOT AN UPGRADE (ruling 8): quarantine with an
        // alert, refund by hand. Nothing is written to members or agents, and the
        // answer comes before the cohort, the chamber, the welcome and the accrual.
        const reason = memberCase === 'returning' ? 'returning_member_checkout' : 'second_checkout_not_upgrade';
        await recordWebhookFailure(supabase, {
          event_id: event.id,
          event_type: event.type,
          reason,
          detail: { session: session.id, member: member.id, held: heldTier, bought: canonical },
        });
        await alertQuarantine(supabase, {
          event_id: event.id,
          event_type: event.type,
          session_id: session.id,
          received: 'bought=' + canonical + ' held=' + (heldTier ?? 'none'),
          reason,
        });
        return json({ received: true, quarantined: true }, 200);
      } else {
        // RETRY or UPGRADE. The bee is always the row's own agent, read by id; it is
        // never re-resolved by email here, and the email's bee is not used.
        if (memberCase === 'upgrade') {
          // UPGRADE (ruling 9, option A): exactly three columns, by the row's id.
          const { error: memberUpgradeErr } = await supabase
            .from('members')
            .update({
              tier: canonical,
              stripe_customer_id: sessionCustomer,
              stripe_subscription_id: sessionSubscription,
            })
            .eq('id', member.id);
          if (memberUpgradeErr) {
            return await failAfterClaim(supabase, event, 'members_upgrade', memberUpgradeErr);
          }
          // Item 5 · an earlier subscription left running. A to-do row whose
          // resolved_at stays empty, and the alert. Both best-effort: neither can
          // fail the webhook, and both come after the member update has landed.
          if (heldSubscription && heldSubscription !== sessionSubscription) {
            await recordWebhookFailure(supabase, {
              event_id: event.id,
              event_type: event.type,
              reason: OLD_SUBSCRIPTION_OPEN_REASON,
              detail: {
                session: session.id,
                member: member.id,
                old_subscription: heldSubscription,
                old_customer: heldCustomer,
                new_subscription: sessionSubscription,
                held: heldTier,
                bought: canonical,
              },
            });
            await alertOldSubscriptionOpen(supabase, {
              event_id: event.id,
              member: member.id,
              old_subscription: heldSubscription,
              old_customer: heldCustomer,
              new_subscription: sessionSubscription,
              held: heldTier,
              bought: canonical,
              since: now().toISOString(),
            });
          }
        }
        let bee: any = null;
        if (member.agent_id) {
          const { data: beeRow, error: beeReadErr } = await supabase
            .from('agents')
            .select('id, name, soul, tier, status')
            .eq('id', member.agent_id)
            .maybeSingle();
          if (beeReadErr) {
            return await failAfterClaim(supabase, event, 'agent_read', beeReadErr);
          }
          bee = beeRow ?? null;
        }
        agentRecord = bee;
        if (bee?.id) {
          if (tierRank(canonical) > tierRank(bee.tier)) {
            // Only ever the tier, upward. RETRY alone may also set the first-flight
            // status, and only when the first checkout's agent write never landed:
            // the bee holds no ranked tier and the row still reads first_flight.
            const beePatch: Record<string, unknown> = { tier: canonical };
            if (memberCase === 'retry' && tierRank(bee.tier) === 0 && member.status === 'first_flight') {
              beePatch.status = 'first_flight';
            }
            const { error: beeUpdateErr } = await supabase
              .from('agents')
              .update(beePatch)
              .eq('id', bee.id);
            if (beeUpdateErr) {
              return await failAfterClaim(supabase, event, 'agents_update', beeUpdateErr);
            }
          }
          // The cohort top-up, the chamber and the welcome, as the FIRST arm runs them.
          try {
            const cohortResult = await upgradeCohortForTierChange(
              supabase as any, bee.id, canonical, bee.soul,
            );
            if (!cohortResult.success) {
              console.error('Cohort upgrade had errors:', cohortResult.errors);
            }
          } catch (cohortError: any) {
            console.error('Cohort upgrade failed:', cohortError.message);
          }
          const beeSoul = soul || bee.soul || 'The Operator';
          const beeStaff = SOUL_TO_STAFF[beeSoul] || 'ESMERALDA';
          const beeHc = await createPersonalHoneycomb(supabase, bee.id, bee.name || agentName || 'New Bee', beeSoul);
          if (beeHc?.id) await postWelcome(supabase, beeHc.id, bee.name || agentName || 'New Bee', beeSoul, beeStaff);
        }
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

  // ── §6, §15 row 5 · REVERSAL: a refund or a dispute ───────────────────────
  // THE FIFTH BLOCK (NIK-RAIL-005). Both events do the same three things — recover
  // the ref, call rail_reverse, record what came back — so they share one tail and
  // differ only in how they reach a payment intent.
  //
  // WHY A REF HAS TO BE RECOVERED AT ALL: a Charge carries no invoice field in the
  // pinned api version, so the accrual's key is not on the event. resolveRef does
  // the recovery; lib/rail/reversal.ts explains it.
  //
  // R33/R34 live in the function, not here: only 'pending' rows reverse, and nothing
  // in_transit or paid is ever touched, debited or clawed back. This block cannot
  // move money even if it is wrong about the ref — the worst it can do is reverse
  // the wrong invoice's PENDING accruals, which is why resolveRef fails closed
  // rather than guessing.
  if (event.type === 'charge.refunded' || event.type === 'charge.dispute.created') {
    const isRefund = event.type === 'charge.refunded';
    const reason: ReversalReason = isRefund ? 'refund' : 'dispute';

    // The charge id is carried only for the failure record, so a human reading a
    // reversal_unresolved row can find the payment at Stripe.
    let chargeId: string | null = null;
    let intentId: string | null = null;

    try {
      if (isRefund) {
        const charge = event.data.object as Stripe.Charge;
        chargeId = charge.id ?? null;
        intentId = chargePaymentIntentId(charge);
      } else {
        const dispute = event.data.object as Stripe.Dispute;
        chargeId = disputeChargeId(dispute);
        // disputeIntent retrieves the charge ONLY when the dispute carries no intent
        // of its own (Disputes.d.ts:84 is nullable, :50 is not).
        intentId = await disputeIntent(stripe, dispute);
      }
    } catch (e) {
      // A Stripe read failed. Not an unresolved ref — ask again (R14, R59).
      return await failAfterClaim(supabase, event, 'reversal_charge_lookup', e);
    }

    let outcome;
    try {
      outcome = await resolveRef(stripe, { paymentIntentId: intentId });
    } catch (e) {
      return await failAfterClaim(supabase, event, 'reversal_resolve_ref', e);
    }

    if ('unresolved' in outcome) {
      // §6 · a row, NO alert — information, like non_membership_payment. A charge
      // with no payment intent, or an invoice payment naming no invoice, is nothing
      // a retry changes.
      await recordWebhookFailure(supabase as any, {
        event_id: event.id,
        event_type: event.type,
        reason: REVERSAL_UNRESOLVED_REASON,
        detail: { cause: outcome.unresolved, charge_id: chargeId, intent_id: intentId },
      });
      console.log('reversal: ref unresolved', {
        event_id: event.id, cause: outcome.unresolved, charge: chargeId,
      });
      return json({ received: true, unresolved: outcome.unresolved });
    }

    let reversal = await reverseForRef(supabase, {
      ref: outcome.ref,
      reason,
      livemode: event.livemode,
    });

    if (!reversal.ok) {
      // NEVER SWALLOWED. In the deploy gap where this code is live and M1b has not
      // run, rail_reverse does not exist and this errors; the 500 is what makes
      // Stripe retry until the function is there (R59).
      return await failAfterClaim(supabase, event, 'rail_reverse', reversal.error);
    }

    // F1 (chat-seat review) · THE SECOND LOOK, and why it is safe.
    //
    // Stripe's invoice_creation on a one-time payment produces a post-purchase
    // invoice. resolveRef then finds that invoice and answers 'in_...', while the
    // accrual for that payment was keyed on the PAYMENT INTENT (§5.5, resolveOneTime)
    // — so the first call comes back known=false and the refund would be quarantined
    // with the money already gone from Stripe. One retry against the intent id fixes
    // it.
    //
    // THIS CANNOT REVERSE THE WRONG INVOICE. The retry ref is a payment-intent id,
    // which belongs to exactly one payment; rail_reverse matches on
    // (stripe_invoice_ref, livemode), so a pi_ ref can only ever match accruals the
    // rail keyed on that same intent. The dangerous direction would be the reverse —
    // guessing an invoice id — and that is not what happens here.
    //
    // Only attempted when the two refs actually differ: for a subscription charge the
    // resolved ref is the invoice and intentId is the intent, so a known=false there
    // does get the second look (it costs one rpc and finds nothing); for a one-time
    // charge with no invoice, resolveRef already returned the intent and there is
    // nothing to retry.
    let refTried = outcome.ref;
    let refSecond: string | null = null;
    if (!reversal.result.known && intentId && outcome.ref !== intentId) {
      refSecond = intentId;
      const second = await reverseForRef(supabase, {
        ref: intentId,
        reason,
        livemode: event.livemode,
      });
      if (!second.ok) {
        return await failAfterClaim(supabase, event, 'rail_reverse_intent', second.error);
      }
      if (second.result.known) {
        reversal = second;
        refTried = intentId;
      }
    }

    const { known, reversed, untouched } = reversal.result;

    if (!known) {
      // Neither ref is known to the rail.
      //
      // F2 (chat-seat review) · THIS MAY BE AN ORDERING PROBLEM, NOT AN UNKNOWN
      // PAYMENT, and §5.8/H3 already settled how to tell: by the event's age. Stripe
      // does not guarantee delivery order, so a refund can arrive before the invoice
      // event that accrued it — and the old code quarantined that permanently, with
      // the accrual landing seconds later and never being reversed. Inside 30
      // minutes, assume the race: release the claim and 500 so Stripe's own backoff
      // re-delivers after the accrual exists. Older than that, it is not a race —
      // a pre-rail invoice or a non-membership payment — and no retry will conjure
      // the accrual, so it is recorded and answered 200.
      //
      // The clock is deps.now(), the same injected one the member race uses, so the
      // boundary is testable without sleeping.
      const ageMs = now().getTime() - event.created * 1000;
      if (ageMs < 30 * 60 * 1000) {
        return await failAfterClaim(supabase, event, 'reversal_ref_unknown_recent', {
          ref: refTried, second_ref: refSecond, age_ms: ageMs, charge_id: chargeId,
        });
      }
      // A row, no alert — information, like non_membership_payment.
      await recordWebhookFailure(supabase as any, {
        event_id: event.id,
        event_type: event.type,
        reason: REVERSAL_UNRESOLVED_REASON,
        detail: {
          ref: outcome.ref,
          second_ref: refSecond,
          event_type: event.type,
          charge_id: chargeId,
          age_ms: ageMs,
        },
      });
      console.log('reversal: ref unknown to the rail', {
        event_id: event.id, ref: outcome.ref, second_ref: refSecond, age_ms: ageMs,
      });
      return json({ received: true, known: false });
    }

    if (untouched > 0) {
      // §6 ruling 6, R35 · money that has left, or is leaving, cannot be reversed
      // here — and a human has to know. This one DOES alert.
      await recordWebhookFailure(supabase as any, {
        event_id: event.id,
        event_type: event.type,
        reason: REFUND_AFTER_PAYOUT_REASON,
        detail: { ref: refTried, reversed, untouched, reason },
      });
      // F4 · the id is labelled for what it is. A reversal ref is an invoice id OR a
      // payment-intent id, never a checkout session, so the default label would have
      // been wrong on this one caller. alertQuarantine cannot throw — its only
      // outward call is inside a try/catch and every other line is string work — so
      // a mail failure after a SUCCESSFUL reversal cannot turn into a 500 and a
      // retry loop (the Sept 22 rule: the alert never takes the webhook down).
      await alertQuarantine(supabase as any, {
        event_id: event.id,
        event_type: event.type,
        session_id: refTried,
        id_label: 'invoice or payment ref',
        received: `${reversed} reversed, ${untouched} already in_transit or paid`,
        reason: REFUND_AFTER_PAYOUT_REASON,
      });
      console.warn('reversal: refund after payout', {
        event_id: event.id, ref: refTried, reversed, untouched,
      });
      return json({ received: true, reversed, untouched });
    }

    console.log('reversal:', {
      event_id: event.id, ref: refTried, second_ref: refSecond, reason, reversed,
      livemode: event.livemode,
    });
    return json({ received: true, reversed });
  }

  return json({ received: true });
}
