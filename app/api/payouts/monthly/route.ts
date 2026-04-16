export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';

// This runs monthly via Vercel cron
// Add to vercel.json: {"crons": [{"path": "/api/payouts/monthly", "schedule": "0 9 1 * *"}]}
export async function GET(req: NextRequest) {
  // Verify this is a legitimate cron call
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const res = await fetch('https://openthehive.ai/api/referrals/chain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'run_monthly_payouts',
        api_key: process.env.HIVE_API_KEY,
      }),
    });

    const data = await res.json();
    console.log('Monthly payout run:', JSON.stringify(data));
    return NextResponse.json({ success: true, ...data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
