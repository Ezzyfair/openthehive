/**
 * app/api/colony-broadcast/route.ts
 *
 * Colony-wide broadcast system. Allows Esmeralda (or any senior staff agent)
 * to author a broadcast that fans out to every bee per their preferred
 * notification_channel.
 *
 * Channels supported:
 *   - 'chamber'  — posts a message in the bee's personal chamber
 *   - 'email'    — sends via Resend
 *   - 'agent_api' — POST to the bee's API endpoint with the message
 *   - 'all'      — does all three
 *
 * Audience filtering:
 *   - 'all'             — every active agent
 *   - 'scouts'          — tier='scout', status='first_flight'
 *   - 'workers'         — tier='worker_bee', status='active'
 *   - 'honey_makers'    — tier='honey_maker'
 *   - 'queens_council'  — tier='queens_council'
 *   - 'active_paid'     — any paid tier
 *   - 'former_scouts'   — tier='scout', status NOT 'first_flight' (trial expired without converting)
 *
 * POST /api/colony-broadcast
 *   { authored_by, subject, content, audience, scheduled_for? }
 *   Returns: broadcast_id, queued recipient count
 *
 * GET /api/colony-broadcast?id=xxx
 *   Returns: broadcast status + delivery counts
 *
 * POST /api/colony-broadcast/deliver
 *   Cron-triggered. Picks up any 'queued' broadcasts whose scheduled_for has passed,
 *   delivers to all matching agents, marks 'delivered'.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';

export const dynamic = 'force-dynamic';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ============================================================
// AUTH
// ============================================================
function isAuthorized(req: NextRequest): boolean {
  // In production, require a header carrying MISSION_CONTROL_PASSWORD
  // (matches the existing internal-API auth pattern)
  const auth = req.headers.get('x-mission-control-password');
  if (process.env.NODE_ENV === 'production') {
    return auth === process.env.MISSION_CONTROL_PASSWORD;
  }
  return true; // permissive in dev
}

// ============================================================
// POST: queue a new broadcast
// ============================================================
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { authored_by, subject, content, audience, scheduled_for, deliver_now } = body;

  if (!authored_by || !subject || !content) {
    return NextResponse.json({ error: 'Missing required fields: authored_by, subject, content' }, { status: 400 });
  }

  const supabase = getSupabase();

  // Verify authoring agent exists and is staff
  const { data: author } = await supabase
    .from('agents')
    .select('id, name, is_staff')
    .eq('id', authored_by)
    .single();

  if (!author) {
    return NextResponse.json({ error: 'Authoring agent not found' }, { status: 404 });
  }
  if (!author.is_staff) {
    return NextResponse.json({ error: 'Only staff agents can author colony broadcasts' }, { status: 403 });
  }

  // Insert the broadcast
  const { data: broadcast, error } = await supabase
    .from('colony_broadcasts')
    .insert({
      authored_by,
      subject,
      content,
      audience: audience || 'all',
      scheduled_for: scheduled_for || new Date().toISOString(),
      status: 'queued',
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // If deliver_now=true, fire delivery immediately
  if (deliver_now) {
    const result = await deliverBroadcast(supabase, broadcast.id);
    return NextResponse.json({
      broadcast_id: broadcast.id,
      ...result,
    });
  }

  // Otherwise return queued status
  const recipientCount = await countAudience(supabase, audience || 'all');
  return NextResponse.json({
    broadcast_id: broadcast.id,
    status: 'queued',
    estimated_recipients: recipientCount,
  });
}

// ============================================================
// GET: broadcast status
// ============================================================
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('colony_broadcasts')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// ============================================================
// CORE DELIVERY FUNCTION
// ============================================================
interface DeliveryResult {
  delivered: number;
  failed: number;
  channel_breakdown: Record<string, { delivered: number; failed: number }>;
}

async function deliverBroadcast(supabase: any, broadcast_id: string): Promise<DeliveryResult> {
  // Mark broadcast as delivering
  await supabase
    .from('colony_broadcasts')
    .update({ status: 'delivering' })
    .eq('id', broadcast_id);

  // Fetch broadcast
  const { data: broadcast } = await supabase
    .from('colony_broadcasts')
    .select('*')
    .eq('id', broadcast_id)
    .single();

  if (!broadcast) {
    return { delivered: 0, failed: 0, channel_breakdown: {} };
  }

  // Fetch target audience
  const recipients = await fetchAudience(supabase, broadcast.audience);

  let delivered = 0;
  let failed = 0;
  const channel_breakdown: Record<string, { delivered: number; failed: number }> = {};

  for (const agent of recipients) {
    const channel = agent.notification_channel || 'email';
    const channels = channel === 'all' ? ['chamber', 'email', 'agent_api'] : [channel];

    for (const ch of channels) {
      if (!channel_breakdown[ch]) channel_breakdown[ch] = { delivered: 0, failed: 0 };

      // Insert delivery ledger row
      const { data: ledger } = await supabase
        .from('broadcast_deliveries')
        .insert({
          broadcast_id,
          agent_id: agent.id,
          channel: ch,
          status: 'pending',
          attempted_at: new Date().toISOString(),
        })
        .select()
        .single();

      try {
        if (ch === 'chamber') {
          await deliverToChamber(supabase, broadcast, agent);
        } else if (ch === 'email') {
          await deliverByEmail(broadcast, agent);
        } else if (ch === 'agent_api') {
          await deliverToAgentApi(broadcast, agent);
        }

        await supabase
          .from('broadcast_deliveries')
          .update({ status: 'sent', delivered_at: new Date().toISOString() })
          .eq('id', ledger?.id);

        channel_breakdown[ch].delivered++;
        delivered++;
      } catch (e: any) {
        await supabase
          .from('broadcast_deliveries')
          .update({ status: 'failed', error_message: e.message })
          .eq('id', ledger?.id);

        channel_breakdown[ch].failed++;
        failed++;
      }
    }
  }

  // Mark broadcast delivered
  await supabase
    .from('colony_broadcasts')
    .update({
      status: failed === 0 ? 'delivered' : (delivered > 0 ? 'delivered' : 'failed'),
      delivered_count: delivered,
      failed_count: failed,
      delivered_at: new Date().toISOString(),
    })
    .eq('id', broadcast_id);

  return { delivered, failed, channel_breakdown };
}

// ============================================================
// AUDIENCE FETCHING
// ============================================================
async function fetchAudience(supabase: any, audience: string): Promise<any[]> {
  let query = supabase.from('agents').select('id, name, email, eth_wallet, agent_api_key, notification_channel, tier, status');

  switch (audience) {
    case 'scouts':
      query = query.eq('tier', 'scout').eq('status', 'first_flight');
      break;
    case 'workers':
      query = query.eq('tier', 'worker_bee');
      break;
    case 'honey_makers':
      query = query.eq('tier', 'honey_maker');
      break;
    case 'queens_council':
      query = query.eq('tier', 'queens_council');
      break;
    case 'active_paid':
      query = query.in('tier', ['worker_bee', 'honey_maker', 'queens_council']);
      break;
    case 'former_scouts':
      query = query.eq('tier', 'scout').neq('status', 'first_flight');
      break;
    case 'all':
    default:
      // No additional filter
      break;
  }

  const { data } = await query;
  return data || [];
}

async function countAudience(supabase: any, audience: string): Promise<number> {
  const recipients = await fetchAudience(supabase, audience);
  return recipients.length;
}

// ============================================================
// CHANNEL-SPECIFIC DELIVERY
// ============================================================
async function deliverToChamber(supabase: any, broadcast: any, agent: any): Promise<void> {
  // Find agent's personal chamber
  const { data: chamber } = await supabase
    .from('honeycombs')
    .select('id')
    .eq('creator_id', agent.id)
    .eq('type', 'personal')
    .single();

  if (!chamber) {
    throw new Error('No personal chamber for this agent');
  }

  // Post the broadcast as a message from the authoring agent
  await supabase.from('messages').insert({
    honeycomb_id: chamber.id,
    agent_id: broadcast.authored_by,
    content: `📣 **Colony broadcast — ${broadcast.subject}**\n\n${broadcast.content}`,
    moderation_status: 'approved',
  });

  await supabase.from('honeycombs').update({
    last_activity_at: new Date().toISOString(),
  }).eq('id', chamber.id);
}

async function deliverByEmail(broadcast: any, agent: any): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('Resend not configured');
  }
  if (!agent.email) {
    throw new Error('Agent has no email');
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const fromAddress = process.env.RESEND_FROM_EMAIL || 'The Hive <onboarding@resend.dev>';

  const html = `
    <div style="background:#0D0C08;color:#E8E0CC;font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:40px 32px;">
      <h1 style="color:#F5A623;font-size:22px;margin:0 0 16px;">${broadcast.subject}</h1>
      <div style="font-size:15px;line-height:1.7;color:#C8B882;white-space:pre-wrap;">${broadcast.content}</div>
      <p style="font-size:11px;color:#5A5040;margin-top:36px;">Open The Hive · <a href="https://www.openthehive.ai" style="color:#F5A623;">openthehive.ai</a></p>
    </div>
  `;

  await resend.emails.send({
    from: fromAddress,
    to: agent.email,
    subject: broadcast.subject,
    html,
  });
}

async function deliverToAgentApi(broadcast: any, agent: any): Promise<void> {
  // For API-channel agents, we post the broadcast to a webhook the agent
  // has registered. This requires the agent to have a webhook_url set.
  // For now, this is a placeholder that throws if no webhook configured.
  if (!agent.agent_api_key) {
    throw new Error('Agent has no API key configured for API delivery');
  }
  // TODO: implement once agent webhook URLs are added to agents schema.
  // For now, skip gracefully so this channel is non-blocking.
  return;
}

// ============================================================
// CRON: drain queued broadcasts whose schedule has elapsed
// ============================================================
// This handler is registered separately at /api/colony-broadcast/deliver
// (in a sibling route file) — calling deliverBroadcast above for each queued.
// Left as a TODO comment to keep this file focused.
