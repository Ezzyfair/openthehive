export const dynamic = 'force-dynamic';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string
  );
}

// GET /api/payouts?agent_key=hive_xxx — check payout status
export async function GET(req: NextRequest) {
  const agentKey = req.nextUrl.searchParams.get('agent_key');
  if (!agentKey) return NextResponse.json({ error: 'agent_key required' }, { status: 400 });

  const supabase = getSupabase();
  const { data: agent } = await supabase
    .from('agents')
    .select('id, name, eth_wallet')
    .eq('agent_api_key', agentKey)
    .single();

  if (!agent) return NextResponse.json({ error: 'Invalid key' }, { status: 401 });

  const { data: earnings } = await supabase
    .from('referral_earnings')
    .select('earned_amount, status, paid_at, level')
    .eq('earning_agent_id', agent.id)
    .order('created_at', { ascending: false })
    .limit(50);

  const pending = (earnings || []).filter(e => e.status === 'pending');
  const pendingTotal = pending.reduce((sum, e) => sum + e.earned_amount, 0);

  return NextResponse.json({
    agent: agent.name,
    wallet: agent.eth_wallet || null,
    pending_amount: pendingTotal.toFixed(2),
    ready: pendingTotal >= 5.00,
    message: pendingTotal >= 5.00
      ? 'Payout ready. Processed on the 1st of each month.'
      : `$${(5.00 - pendingTotal).toFixed(2)} more needed to reach $5 minimum.`,
  });
}

// POST /api/payouts/process — monthly cron job processes all pending payouts
export async function POST(req: NextRequest) {
  // Verify this is called by our cron (internal only)
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.HIVE_API_KEY}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();

  // Find all agents with $5+ pending earnings and a wallet set
  const { data: agents } = await supabase
    .from('agents')
    .select('id, name, eth_wallet')
    .not('eth_wallet', 'is', null);

  if (!agents) return NextResponse.json({ processed: 0 });

  const payouts = [];

  for (const agent of agents) {
    const { data: pending } = await supabase
      .from('referral_earnings')
      .select('id, earned_amount')
      .eq('earning_agent_id', agent.id)
      .eq('status', 'pending');

    if (!pending || pending.length === 0) continue;

    const total = pending.reduce((sum, e) => sum + e.earned_amount, 0);
    if (total < 5.00) continue;

    // Mark as paid
    const ids = pending.map(e => e.id);
    await supabase
      .from('referral_earnings')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .in('id', ids);

    payouts.push({
      agent: agent.name,
      wallet: agent.eth_wallet,
      amount: total.toFixed(2),
    });

    // TODO: Trigger actual Strike/ETH payment here
    // For now records the payout — manual processing until Strike API integrated
  }

  return NextResponse.json({
    success: true,
    processed: payouts.length,
    payouts,
    note: 'Payouts marked as paid. Actual transfer via Strike/ETH pending API integration.',
  });
}
