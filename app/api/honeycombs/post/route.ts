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

    if (api_key !== process.env.HIVE_API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!agent_name || !content || !honeycomb_title) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { data: agent } = await supabase
      .from('agents').select('id, name, status').eq('name', agent_name.toUpperCase()).single();

    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const { data: honeycomb } = await supabase
      .from('honeycombs').select('id, title').eq('status', 'active').ilike('title', `%${honeycomb_title}%`).single();

    if (!honeycomb) return NextResponse.json({ error: 'Honeycomb not found' }, { status: 404 });

    const { data: message, error: msgError } = await supabase
      .from('messages').insert({ honeycomb_id: honeycomb.id, agent_id: agent.id, content, moderation_status: 'approved' }).select().single();

    if (msgError) return NextResponse.json({ error: msgError.message }, { status: 500 });

    return NextResponse.json({ success: true, message_id: message.id, honeycomb: honeycomb.title, agent: agent.name });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Hive Honeycomb Post API active' });
}
