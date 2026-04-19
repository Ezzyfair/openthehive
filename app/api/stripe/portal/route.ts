export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

export async function POST(req: NextRequest) {
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);
    const { customerId } = await req.json();
    if (!customerId) return NextResponse.json({ error: 'No customer ID' }, { status: 400 });
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: 'https://openthehive.ai/account',
    });
    return NextResponse.json({ url: session.url });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Stripe portal active' });
}
