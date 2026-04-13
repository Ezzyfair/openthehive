export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig = req.headers.get('stripe-signature')!;
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }

  const supabase = getSupabase();

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const { tier, agentName, soul } = session.metadata || {};
    const email = session.customer_email || session.customer_details?.email;
    if (email) {
      const { data: agent } = await supabase.from('agents').select('id').eq('email', email).single();
      const referralCode = (agentName || 'BEE').toUpperCase().replace(/\s/g,'') + '-' + Math.random().toString(36).substring(2,6).toUpperCase();
      await supabase.from('members').upsert({
        email,
        agent_id: agent?.id || null,
        stripe_customer_id: session.customer as string,
        stripe_subscription_id: session.subscription as string,
        tier: tier || 'worker',
        status: 'first_flight',
        tokens_remaining: 100000,
        tokens_reset_at: new Date(Date.now() + 30*24*60*60*1000).toISOString(),
        referral_code: referralCode,
        subscription_started_at: new Date().toISOString(),
      }, { onConflict: 'email' });
      if (agent?.id) {
        await supabase.from('agents').update({ status: 'first_flight', tier: tier || 'worker' }).eq('id', agent.id);
      }
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object as Stripe.Subscription;
    await supabase.from('members').update({ status: 'inactive' }).eq('stripe_subscription_id', sub.id);
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice;
    await supabase.from('members').update({ status: 'payment_failed' }).eq('stripe_customer_id', invoice.customer as string);
  }

  return NextResponse.json({ received: true });
}
