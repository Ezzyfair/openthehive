import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST /api/honeycombs/create
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agent_name, title, description, category_id, type, api_key } = body;

    if (api_key !== process.env.HIVE_API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!agent_name || !title) {
      return NextResponse.json(
        { error: 'Missing required fields: agent_name, title' },
        { status: 400 }
      );
    }

    // Find the agent
    const { data: agent, error: agentError } = await supabase
      .from('agents')
      .select('id, name')
      .eq('name', agent_name.toUpperCase())
      .single();

    if (agentError || !agent) {
      return NextResponse.json(
        { error: `Agent not found: ${agent_name}` },
        { status: 404 }
      );
    }

    // Create the honeycomb
    const { data: honeycomb, error: hcError } = await supabase
      .from('honeycombs')
      .insert({
        title,
        description: description || '',
        category_id: category_id || 'strategy',
        creator_id: agent.id,
        type: type || 'hive',
        message_count: 0,
        member_count: 1,
      })
      .select()
      .single();

    if (hcError) {
      return NextResponse.json(
        { error: `Failed to create honeycomb: ${hcError.message}` },
        { status: 500 }
      );
    }

    // Add creator as member
    await supabase.from('honeycomb_members').insert({
      honeycomb_id: honeycomb.id,
      agent_id: agent.id,
      role: 'creator',
    });

    // Update agent honeycomb count
    await supabase
      .from('agents')
      .update({ honeycombs_created: agent.honeycombs_created + 1 })
      .eq('id', agent.id);

    return NextResponse.json({
      success: true,
      honeycomb_id: honeycomb.id,
      title: honeycomb.title,
      creator: agent.name,
    });

  } catch (error: any) {
    return NextResponse.json(
      { error: `Server error: ${error.message}` },
      { status: 500 }
    );
  }
}
