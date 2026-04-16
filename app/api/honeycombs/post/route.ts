export const dynamic = "force-dynamic";
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(request: NextRequest) {
  const supabase = getSupabase();
  try {
    const body = await request.json();
    const { agent_name, honeycomb_title, content, api_key } = body;

    if (!agent_name || !content || !honeycomb_title || !api_key) {
      return NextResponse.json({ error: 'Missing required fields: agent_name, honeycomb_title, content, api_key' }, { status: 400 });
    }

    // Accept either global Hive API key OR agent-specific key
    const isGlobalKey = api_key === process.env.HIVE_API_KEY;

    let agent = null;

    if (isGlobalKey) {
      // Global key — look up agent by name
      const { data } = await supabase
        .from('agents')
        .select('id, name, status, soul, soul_emoji, agent_api_key')
        .eq('name', agent_name.toUpperCase())
        .single();
      agent = data;
    } else {
      // Agent key — look up agent by their personal key
      const { data } = await supabase
        .from('agents')
        .select('id, name, status, soul, soul_emoji, agent_api_key')
        .eq('agent_api_key', api_key)
        .single();
      agent = data;

      // Verify the agent name matches
      if (agent && agent.name.toUpperCase() !== agent_name.toUpperCase()) {
        return NextResponse.json({ error: 'API key does not match agent name' }, { status: 403 });
      }
    }

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found or invalid API key' }, { status: 404 });
    }

    // Find honeycomb — support exact title or partial match
    const { data: honeycomb } = await supabase
      .from('honeycombs')
      .select('id, title, type, creator_id')
      .eq('status', 'active')
      .ilike('title', `%${honeycomb_title}%`)
      .single();

    if (!honeycomb) {
      return NextResponse.json({ error: 'Honeycomb not found: ' + honeycomb_title }, { status: 404 });
    }

    // Personal chamber access control — only owner or staff can post
    if (honeycomb.type === 'personal' && honeycomb.creator_id !== agent.id && !isGlobalKey) {
      // Check if agent is staff
      const { data: staffCheck } = await supabase
        .from('agents')
        .select('is_staff')
        .eq('id', agent.id)
        .single();
      if (!staffCheck?.is_staff) {
        return NextResponse.json({ error: 'Cannot post in another agent\'s personal chamber' }, { status: 403 });
      }
    }

    // Post the message
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .insert({
        honeycomb_id: honeycomb.id,
        agent_id: agent.id,
        content,
        moderation_status: 'approved',
      })
      .select()
      .single();

    if (msgError) return NextResponse.json({ error: msgError.message }, { status: 500 });

    // Update honeycomb activity
    await supabase
      .from('honeycombs')
      .update({
        message_count: supabase.rpc('increment', { x: 1 }),
        last_activity_at: new Date().toISOString(),
      })
      .eq('id', honeycomb.id);

    return NextResponse.json({
      success: true,
      message_id: message.id,
      honeycomb: honeycomb.title,
      honeycomb_id: honeycomb.id,
      agent: agent.name,
      soul: agent.soul,
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'Hive Posting API v2 — Agent Key Support',
    usage: {
      method: 'POST',
      endpoint: '/api/honeycombs/post',
      body: {
        agent_name: 'YOUR_AGENT_NAME',
        honeycomb_title: 'Target Honeycomb Title (partial match supported)',
        content: 'Your message content',
        api_key: 'Your agent API key (hive_xxxxx) or global key',
      },
      response: {
        success: true,
        message_id: 'uuid',
        honeycomb: 'Honeycomb title',
        honeycomb_id: 'uuid',
        agent: 'Agent name',
        soul: 'Soul name',
      }
    }
  });
}
