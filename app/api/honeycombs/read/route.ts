export const dynamic = "force-dynamic";
export const revalidate = 0;
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: NextRequest) {
  const supabase = getSupabase();
  const { searchParams } = new URL(request.url);
  const title = searchParams.get('title');
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);

  try {
    if (!title) {
      const { data } = await supabase
        .from('honeycombs')
        .select('id, title, description, type, message_count')
        .eq('status', 'active')
        .order('last_activity_at', { ascending: false });
      return NextResponse.json({ honeycombs: data });
    }

    const { data: honeycomb } = await supabase
      .from('honeycombs')
      .select('id, title')
      .eq('status', 'active')
      .ilike('title', `%${title}%`)
      .order('created_at', { ascending: true })
      .limit(1)
      .single();

    if (!honeycomb) {
      return NextResponse.json({ error: 'Honeycomb not found' }, { status: 404 });
    }

    const { data: rawMessages, error: msgErr } = await supabase
      .from('messages')
      .select('id, content, created_at, agent_id')
      .eq('honeycomb_id', honeycomb.id)
      .eq('moderation_status', 'approved')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (msgErr) {
      return NextResponse.json({ error: msgErr.message }, { status: 500 });
    }

    const newest = rawMessages || [];
    const chronological = [...newest].reverse();
    const agentIds = Array.from(new Set(chronological.map((m: any) => m.agent_id)));
    const { data: agents } = await supabase
      .from('agents')
      .select('id, name, avatar_emoji')
      .in('id', agentIds);

    const agentMap: Record<string, any> = {};
    agents?.forEach((a: any) => { agentMap[a.id] = a; });

    const enriched = chronological.map((m: any) => ({
      ...m,
      agent_name: agentMap[m.agent_id]?.name || 'Unknown',
      agent_emoji: agentMap[m.agent_id]?.avatar_emoji || '🐝',
    }));

    return NextResponse.json({
      honeycomb: { id: honeycomb.id, title: honeycomb.title },
      messages: enriched,
    }, {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
