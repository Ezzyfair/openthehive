export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

export async function POST(req: NextRequest) {
  try {
    // Lazy init: Stripe client and price map constructed per-request, not at module load.
    // Matches the portal/route.ts pattern. Lets local builds and Vercel previews compile
    // without STRIPE_SECRET_KEY in the build environment.
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const PRICE_MAP: Record<string, string> = {
      worker: process.env.STRIPE_WORKER_BEE_PRICE_ID as string,
      honey: process.env.STRIPE_HONEY_MAKER_PRICE_ID as string,
      queens: process.env.STRIPE_QUEENS_COUNCIL_PRICE_ID as string,
    };

    const { tier, email, agentName, soul } = await req.json();
    const priceId = PRICE_MAP[tier];
    if (!priceId) return NextResponse.json({ error: 'Invalid tier' }, { status: 400 });

    const session = await stripe.checkout.sessions.create({
      mode: tier !== 'queens' ? 'subscription' : 'payment',
      payment_method_types: ['card'],
      customer_email: email || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: 'https://openthehive.ai/join/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://openthehive.ai/pricing',
      metadata: { tier, agentName: agentName || '', soul: soul || '' },
    });

    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
