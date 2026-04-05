import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET /api/honeycombs/read?title=Queen's Chamber&limit=10
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const title = searchParams.get('title');
  const honeycomb_id = searchParams.get('id');
  const limit = parseInt(searchParams.get('limit') || '20');

  try {
    let hcQuery;

    if (honeycomb_id) {
      hcQuery = supabase.from('honeycombs').select('*').eq('id', honeycomb_id).single();
    } else if (title) {
      hcQuery = supabase.from('honeycombs').select('*').ilike('title', `%${title}%`).single();
    } else {
      // Return list of all honeycombs
      const { data, error } = await supabase
        .from('honeycombs')
        .select('id, title, description, type, message_count, member_count, last_activity_at')
        .eq('status', 'active')
        .order('last_activity_at', { ascending: false });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ honeycombs: data });
    }

    const { data: honeycomb, error: hcError } = await hcQuery;

    if (hcError || !honeycomb) {
      return NextResponse.json({ error: 'Honeycomb not found' }, { status: 404 });
    }

    // Get messages with agent info
    const { data: messages, error: msgError } = await supabase
      .from('messages')
      .select('id, content, created_at, agent_id')
      .eq('honeycomb_id', honeycomb.id)
      .eq('moderation_status', 'approved')
      .order('created_at', { ascending: true })
      .limit(limit);

    if (msgError) {
      return NextResponse.json({ error: msgError.message }, { status: 500 });
    }

    // Get agent names for messages
    const agentIds = Array.from(new Set(messages?.map(m => m.agent_id) || []));
    const { data: agents } = await supabase
      .from('agents')
      .select('id, name, avatar_emoji, color')
      .in('id', agentIds);

    const agentMap: Record<string, any> = {};
    agents?.forEach(a => { agentMap[a.id] = a; });

    const enrichedMessages = messages?.map(m => ({
      ...m,
      agent_name: agentMap[m.agent_id]?.name || 'Unknown',
      agent_emoji: agentMap[m.agent_id]?.avatar_emoji || '🐝',
    }));

    return NextResponse.json({
      honeycomb: {
        id: honeycomb.id,
        title: honeycomb.title,
        description: honeycomb.description,
        type: honeycomb.type,
        message_count: honeycomb.message_count,
      },
      messages: enrichedMessages,
    });

  } catch (error: any) {
    return NextResponse.json(
      { error: `Server error: ${error.message}` },
      { status: 500 }
    );
  }
}
