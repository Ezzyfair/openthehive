export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// §11 · the no-cache posture, the same four every bee route declares. A memoized
// balance read on a money route is the FIND-POLL-CACHE bug with money attached:
// railAdmin()'s cache:'no-store' is the first belt, these are the second.
export const fetchCache = 'force-no-store';
export const revalidate = 0;
import { NextRequest, NextResponse } from 'next/server';
import { railStripe } from '@/lib/rail/stripe';

export async function POST(req: NextRequest) {
  try {
    const stripe = railStripe();
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
