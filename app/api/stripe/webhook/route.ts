export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { upgradeCohortForTierChange } from '@/lib/cohort-assignment';
import { recordSubscriptionEarnings } from '@/lib/referral-engine';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

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
  await supabase.from('honeycombs').update({
    message_count: 1,
    last_activity_at: new Date().toISOString(),
  }).eq('id', honeycombId);
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
  const body = await req.text();
  const sig = req.headers.get('stripe-signature');
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig as string, process.env.STRIPE_WEBHOOK_SECRET as string);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const supabase = getSupabase();

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const { tier, agentName, soul } = session.metadata || {};
    const email = session.customer_email || session.customer_details?.email;

    let agentRecord: any = null;

    if (email) {
      const { data: agent } = await supabase.from('agents').select('id, name, soul').eq('email', email).single();
      agentRecord = agent;
      const referralCode = (agentName || 'BEE').toUpperCase().replace(/\s/g, '') + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
      const walletExpiry = new Date();
      walletExpiry.setDate(walletExpiry.getDate() + 90);
      await supabase.from('members').upsert({
        email,
        agent_id: agent?.id || null,
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
        tier: tier || 'worker',
        status: 'first_flight',
        tokens_remaining: 100000,
        tokens_reset_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        referral_code: referralCode,
        subscription_started_at: new Date().toISOString(),
        wallet_expires_at: walletExpiry.toISOString(),
      }, { onConflict: 'email' });

      if (agent?.id) {
        await supabase.from('agents').update({ status: 'first_flight', tier: tier || 'worker' }).eq('id', agent.id);
        // Top up skill cohort for new tier (V4 §2.10) — idempotent, only adds new skills
        try {
          const newTier = (tier === 'worker' ? 'worker_bee' : (tier || 'worker_bee')) as any;
          const cohortResult = await upgradeCohortForTierChange(supabase, agent.id, newTier, agent.soul);
          if (!cohortResult.success) {
            console.error('Cohort upgrade had errors:', cohortResult.errors);
          }
        } catch (cohortError: any) {
          console.error('Cohort upgrade failed:', cohortError.message);
        }
        const agentSoul = soul || agent.soul || 'The Operator';
        const staffName = SOUL_TO_STAFF[agentSoul] || 'ESMERALDA';
        const hc = await createPersonalHoneycomb(supabase, agent.id, agent.name || agentName || 'New Bee', agentSoul);
        if (hc) await postWelcome(supabase, hc.id, agent.name || agentName || 'New Bee', agentSoul, staffName);
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
  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object as Stripe.Invoice;
    const customerId = invoice.customer as string;

    if (customerId) {
      const { data: member } = await supabase
        .from('members')
        .select('agent_id')
        .eq('stripe_customer_id', customerId)
        .single();

      if (member?.agent_id) {
        await fireCascade(supabase, member.agent_id, invoice.amount_paid ?? 0);
      } else {
        console.warn('invoice.payment_succeeded: no member found for customer', customerId);
      }
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    await supabase.from('members').update({
      status: 'inactive',
      subscription_expires_at: new Date().toISOString(),
    }).eq('stripe_subscription_id', sub.id);
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    await supabase.from('members').update({ status: 'payment_failed' }).eq('stripe_customer_id', invoice.customer as string);
  }

  return NextResponse.json({ received: true });
}
