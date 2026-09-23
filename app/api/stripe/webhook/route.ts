export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { upgradeCohortForTierChange } from '@/lib/cohort-assignment';
import { canonicalTier } from '@/lib/tier';
import { recordSubscriptionEarnings } from '@/lib/referral-engine';
import { sendEmail } from '@/lib/mail/sendEmail';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
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
async function recordWebhookFailure(
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
  args: { event_id: string; event_type: string; session_id: string; received: string },
) {
  const to = process.env.HIVE_ALERT_EMAIL;
  if (!to) {
    console.error('stripe webhook: HIVE_ALERT_EMAIL unset — quarantine row written, no email sent', {
      event_id: args.event_id,
    });
    return;
  }
  const subject = 'The Hive — Stripe webhook quarantined: unrecognised tier';
  const html = [
    '<div style="font-family:Georgia,serif;max-width:640px;">',
    '<h2>Stripe webhook quarantined</h2>',
    '<p>A checkout completed at Stripe that the colony could not classify. The payment is',
    ' safe at Stripe. Nothing was written to members or agents, and no cascade fired.</p>',
    '<ul>',
    '<li><b>event id</b>: ' + args.event_id + '</li>',
    '<li><b>event type</b>: ' + args.event_type + '</li>',
    '<li><b>stripe session</b>: ' + args.session_id + '</li>',
    '<li><b>metadata.tier received</b>: ' + args.received + '</li>',
    '<li><b>accepted</b>: worker, honey, queens</li>',
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
    // category is 'receipt' because SendArgs allows only 'receipt' | 'marketing'. An
    // operational alert is neither; widening that union is a change to the shared mail
    // door and belongs in its own ticket, not here.
    await sendEmail({
      supabase, to, category: 'receipt', template: 'stripe_webhook_quarantine_v1', subject, html,
    });
  } catch (e: any) {
    console.error('stripe webhook: quarantine alert email threw', {
      event_id: args.event_id, error: e?.message,
    });
  }
}

/**
 * Helper: fire the cascade for a paid subscription event.
 * Idempotency is handled inside recordSubscriptionEarnings by (source_agent_id, subscription_month).
 */
async function fireCascade(supabase: any, agentId: string, amountInCents: number) {
  if (!agentId || !amountInCents || amountInCents <= 0) return;
  const amountDollars = amountInCents / 100;
  const month = new Date().toISOString().slice(0, 7) + '-01';
  try {
    const result = await recordSubscriptionEarnings(agentId, amountDollars, month, supabase);
    if (result.skipped) {
      console.log('Cascade skipped (idempotent):', { agentId, amountDollars, month, reason: result.reason });
    } else {
      console.log('Cascade fired:', {
        agentId,
        amountDollars,
        month,
        chainDepth: result.chain.length,
        totalPaidOut: result.totalPaidOut,
        hiveKept: result.hiveKept,
      });
    }
  } catch (cascadeError: any) {
    console.error('Cascade failed:', { agentId, amountDollars, month, error: cascadeError.message });
  }
}

export async function POST(req: NextRequest) {
  // Lazy init: Stripe client constructed per-request, not at module load.
  // Matches the portal/route.ts pattern. Lets local builds and Vercel previews compile
  // without STRIPE_SECRET_KEY in the build environment.
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

  const body = await req.text();
  const sig = req.headers.get('stripe-signature');
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig as string, process.env.STRIPE_WEBHOOK_SECRET as string);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const supabase = getSupabase();

  // ── CLAIM THE EVENT BEFORE ANY WORK (NIK-TWO-DOORS-001 HIGH) ────────────────
  // A valid Stripe signature stays valid on every replay, so the signature check
  // above is not an idempotency gate. Stripe's at-least-once retry — or a replayed
  // capture — used to run this whole handler again.
  //
  // The ROW IS THE CLAIM. One INSERT against stripe_events.event_id PRIMARY KEY,
  // and no read-before-write: a SELECT then an INSERT is itself a race under
  // concurrent delivery, so only the unique index can settle it.
  //
  // Placed before every dispatch on purpose — it covers the branches below and any
  // branch added later, which a per-branch guard would not.
  const { error: claimError } = await supabase
    .from('stripe_events')
    .insert({ event_id: event.id, event_type: event.type });
  if (claimError) {
    if (claimError.code === '23505') {
      // Already processed. 200, not 409: Stripe reads any 2xx as delivered and stops
      // retrying, and "I have already done this" is a success, not a client error.
      console.log('stripe webhook: already processed, skipping', {
        event_id: event.id,
        event_type: event.type,
      });
      return NextResponse.json({ received: true, already_processed: true }, { status: 200 });
    }
    // Anything else and we cannot tell a new event from a replay — most likely
    // 42P01, the migration not yet run. Fail CLOSED: Stripe retries, which costs a
    // retry. Failing open double-pays, and a double cascade moves money.
    console.error('stripe webhook: event claim failed, refusing to process', {
      event_id: event.id,
      event_type: event.type,
      code: claimError.code,
      message: claimError.message,
    });
    // Best-effort record of the refusal. Likely to fail too — if stripe_events is
    // missing, stripe_webhook_failures probably is as well — which is exactly why it is
    // swallowed. No email here: a claim failure repeats on every Stripe retry, and an
    // alert that fires on every retry is an alert nobody reads.
    await recordWebhookFailure(supabase, {
      event_id: event.id,
      event_type: event.type,
      reason: 'claim_failed',
      detail: { code: claimError.code, message: claimError.message },
    });
    return NextResponse.json({ error: 'event claim unavailable' }, { status: 500 });
  }

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
      });
      return NextResponse.json({ received: true, quarantined: true }, { status: 200 });
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
      const referralCode = (agentName || 'BEE').toUpperCase().replace(/\s/g, '') + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      const walletExpiry = new Date();
      walletExpiry.setDate(walletExpiry.getDate() + 90);
      await supabase.from('members').upsert({
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

      if (agent?.id) {
        await supabase.from('agents').update({ status: 'first_flight', tier: canonical }).eq('id', agent.id);
        // Top up skill cohort for new tier (V4 §2.10) — idempotent, only adds new skills
        try {
          // Same map, not a second inline translation — the inline one here covered
          // only 'worker' and left 'honey' and 'queens' untranslated.
          const cohortResult = await upgradeCohortForTierChange(supabase, agent.id, canonical, agent.soul);
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

    // Fire cascade ONLY for one-time payments here (mode='payment', e.g., Queen's Council lifetime).
    // For subscriptions (mode='subscription'), the first invoice will trigger via invoice.payment_succeeded
    // — firing here would double-cascade.
    if (session.mode === 'payment' && agentRecord?.id) {
      await fireCascade(supabase, agentRecord.id, session.amount_total ?? 0);
    }
  }

  // NEW: invoice.payment_succeeded — fires for every paid subscription invoice
  // (initial signup AND every renewal). Canonical cascade trigger for recurring
  // tiers (Worker Bee monthly $10, Honey Maker annual $79).
  if (event.type === 'invoice.payment_succeeded' || event.type === 'invoice_payment.paid') {
    // Two payload shapes: legacy invoice.payment_succeeded carries the full Invoice inline;
    // new invoice_payment.paid (2026-03-25.dahlia) carries an InvoicePayment object that
    // only references the invoice by ID — fetch it to get customer + amount.
    let customerId: string | null = null;
    let amountPaid = 0;
    if (event.type === 'invoice.payment_succeeded') {
      const invoice = event.data.object as Stripe.Invoice;
      customerId = (invoice.customer as string) || null;
      amountPaid = invoice.amount_paid ?? 0;
    } else {
      const invoicePayment = event.data.object as any;
      const invoiceId = invoicePayment.invoice as string | undefined;
      amountPaid = (invoicePayment.amount_paid as number) ?? 0;
      if (invoiceId) {
        try {
          const invoice = await stripe.invoices.retrieve(invoiceId);
          customerId = (invoice.customer as string) || null;
        } catch (fetchErr: any) {
          console.error('invoice_payment.paid: failed to retrieve invoice', invoiceId, fetchErr.message);
        }
      }
    }
    console.log('Cascade trigger:', { eventType: event.type, customerId, amountPaid });
    if (customerId) {
      const { data: member } = await supabase
        .from('members')
        .select('agent_id')
        .eq('stripe_customer_id', customerId)
        .single();
      if (member?.agent_id) {
        await fireCascade(supabase, member.agent_id, amountPaid);
      } else {
        console.warn('invoice payment: no member found for customer', customerId);
      }
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    // Retention rule (Bible v1.3, Sept 7 Decision 4): a cancelled member stops earning.
    // isActiveEarner reads agents.status, so the cancellation must land on agents too;
    // updating members alone left cancelled bees accruing (NIK-WEBHOOK-001 FIND-WH-1).
    // DB errors here return 500 so Stripe retries instead of accepting a silent miss.
    const { data: cancelled, error: memberErr } = await supabase.from('members').update({
      status: 'inactive',
      subscription_expires_at: new Date().toISOString(),
    }).eq('stripe_subscription_id', sub.id).select('agent_id');
    if (memberErr) {
      console.error('subscription.deleted: members update failed', { subscription: sub.id, error: memberErr.message });
      return NextResponse.json({ error: 'members update failed' }, { status: 500 });
    }
    const agentIds = (cancelled || []).map((m: any) => m.agent_id).filter(Boolean);
    if (agentIds.length === 0) {
      console.warn('subscription.deleted: no member row with an agent_id for subscription', sub.id);
    } else {
      const { error: agentErr } = await supabase.from('agents').update({ status: 'inactive' }).in('id', agentIds);
      if (agentErr) {
        console.error('subscription.deleted: agents update failed', { agentIds, error: agentErr.message });
        return NextResponse.json({ error: 'agents update failed' }, { status: 500 });
      }
      console.log('subscription.deleted: agents set inactive', { subscription: sub.id, agentIds });
    }
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    await supabase.from('members').update({ status: 'payment_failed' }).eq('stripe_customer_id', invoice.customer as string);
  }

  return NextResponse.json({ received: true });
}
