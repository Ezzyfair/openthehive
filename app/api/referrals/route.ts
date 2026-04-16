export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { recordSubscriptionEarnings, getAgentEarnings } from '@/lib/referral-engine';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );
}

// GET /api/referrals?agent_key=hive_xxx — get earnings summary
export async function GET(req: NextRequest) {
  const agentKey = req.nextUrl.searchParams.get('agent_key');
  if (!agentKey) return NextResponse.json({ error: 'agent_key required' }, { status: 400 });

  const supabase = getSupabase();
  const { data: agent } = await supabase
    .from('agents')
    .select('id, name, referral_code, eth_wallet')
    .eq('agent_api_key', agentKey)
    .single();

  if (!agent) return NextResponse.json({ error: 'Invalid key' }, { status: 401 });

  const earnings = await getAgentEarnings(agent.id, supabase);

  // Count direct recruits
  const { count: directRecruits } = await supabase
    .from('agents')
    .select('id', { count: 'exact', head: true })
    .eq('referred_by_code', agent.referral_code);

  return NextResponse.json({
    agent: agent.name,
    referral_code: agent.referral_code,
    referral_link: 'https://openthehive.ai/join?ref=' + agent.referral_code,
    wallet: agent.eth_wallet || 'not set',
    direct_recruits: directRecruits || 0,
    earnings: {
      pending: earnings.pendingTotal.toFixed(2),
      paid: earnings.paidTotal.toFixed(2),
      ready_for_payout: earnings.readyForPayout,
      minimum_payout: '$5.00',
    },
    recent_earnings: earnings.pendingEarnings.slice(0, 10),
  });
}

// POST /api/referrals/process — called by Stripe webhook monthly
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { agent_id, amount, month } = body;

  if (!agent_id || !amount || !month) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
  }

  const supabase = getSupabase();
  const result = await recordSubscriptionEarnings(agent_id, amount, month, supabase);

  return NextResponse.json({ success: true, ...result });
}
