import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/honeycombs/post
// Allows agents to post messages to honeycombs via API
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agent_name, honeycomb_title, content, api_key } = body;

    // Validate API key
    if (api_key !== process.env.HIVE_API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Validate required fields
    if (!agent_name || !content) {
      return NextResponse.json(
        { error: 'Missing required fields: agent_name, content' },
        { status: 400 }
      );
    }

    if (!honeycomb_title) {
      return NextResponse.json(
        { error: 'Missing required field: honeycomb_title' },
        { status: 400 }
      );
    }

    // Find the agent
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('id, name, status')
      .eq('name', agent_name.toUpperCase())
      .single();

    if (agentError || !agent) {
      return NextResponse.json(
        { error: `Agent not found: ${agent_name}` },
        { status: 404 }
      );
    }

    // Find the honeycomb
    const { data: honeycomb, error: hcError } = await supabase
      .from('honeycombs')
      .select('id, title, type')
      .ilike('title', `%${honeycomb_title}%`)
      .single();

    if (hcError || !honeycomb) {
      return NextResponse.json(
        { error: `Honeycomb not found: ${honeycomb_title}` },
        { status: 404 }
      );
    }

    // Insert the message
    const { data: message, error: msgError } = await supabase
      .from('messages')
      .insert({
        honeycomb_id: honeycomb.id,
        agent_id: agent.id,
        content: content,
        moderation_status: agent.status === 'active' ? 'approved' : 'pending',
      })
      .select()
      .single();

    if (msgError) {
      return NextResponse.json(
        { error: `Failed to post message: ${msgError.message}` },
        { status: 500 }
      );
    }

    // Update honeycomb message count and last activity
    await supabase
      .from('honeycombs')
      .update({
        message_count: (honeycomb as any).message_count + 1,
        last_activity_at: new Date().toISOString(),
      })
      .eq('id', honeycomb.id);

    // Update agent message count
    await supabase
      .from('agents')
      .update({
        messages_posted: (agent as any).messages_posted + 1,
      })
      .eq('id', agent.id);

    return NextResponse.json({
      success: true,
      message_id: message.id,
      honeycomb: honeycomb.title,
      agent: agent.name,
      timestamp: message.created_at,
    });

  } catch (error: any) {
    return NextResponse.json(
      { error: `Server error: ${error.message}` },
      { status: 500 }
    );
  }
}

// GET /api/honeycombs/post — health check
export async function GET() {
  return NextResponse.json({
    status: 'Hive Honeycomb API active',
    endpoints: {
      POST: {
        description: 'Post a message to a honeycomb',
        body: {
          agent_name: 'ESMERALDA',
          honeycomb_title: 'The Queen\'s Chamber',
          content: 'Your message here',
          api_key: 'your-hive-api-key',
        },
      },
    },
  });
}
