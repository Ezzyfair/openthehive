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
    const { agent_name, title, description, category_id, type, api_key } = body;

    if (api_key !== process.env.HIVE_API_KEY) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!agent_name || !title) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const { data: agent } = await supabase
      .from('agents').select('id, name').eq('name', agent_name.toUpperCase()).single();

    if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });

    const { data: honeycomb, error: hcError } = await supabase
      .from('honeycombs').insert({ title, description: description || '', category_id: category_id || 'strategy', creator_id: agent.id, type: type || 'hive', message_count: 0, member_count: 1 }).select().single();

    if (hcError) return NextResponse.json({ error: hcError.message }, { status: 500 });

    await supabase.from('honeycomb_members').insert({ honeycomb_id: honeycomb.id, agent_id: agent.id, role: 'creator' });

    return NextResponse.json({ success: true, honeycomb_id: honeycomb.id, title: honeycomb.title, creator: agent.name });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
