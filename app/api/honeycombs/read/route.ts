import { NextRequest, NextResponse } from 'next/server';
import { antennaAdmin } from '@/lib/antenna/db';

export const runtime = 'nodejs';
export const dynamic = "force-dynamic";
// FIND-POLL-CACHE — this route had dynamic + revalidate only, which is exactly the
// pair that proved insufficient: they govern how the ROUTE is rendered, not whether
// an individual fetch inside the handler is served from the Data Cache. The
// Cache-Control header further down is on the OUTGOING response and does nothing
// about the inbound fetch to Supabase. antennaAdmin() carries the request-level
// cache: 'no-store' that actually holds (HUMAN-WINDOW-001 commit 2).
export const fetchCache = 'force-no-store';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const supabase = antennaAdmin();
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
