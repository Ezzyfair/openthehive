export const dynamic = "force-dynamic";
import { supabase } from '@/lib/supabase';
import MissionControlClient from '@/components/MissionControlClient';

async function getStats() {
  const [agents, honeycombs, messages, recentMessages] = await Promise.all([
    supabase.from('agents').select('id, name, is_staff, status', { count: 'exact' }),
    supabase.from('honeycombs').select('id, title, message_count, last_activity_at, status', { count: 'exact' }).eq('status', 'active'),
    supabase.from('messages').select('id', { count: 'exact' }).eq('moderation_status', 'approved'),
    supabase.from('messages')
      .select('id, content, created_at, agent_id, honeycomb_id')
      .eq('moderation_status', 'approved')
      .order('created_at', { ascending: false })
      .limit(20),
  ]);

  // Get agents for enrichment
  const { data: allAgents } = await supabase.from('agents').select('id, name, avatar_emoji, color');
  const agentMap: Record<string, any> = {};
  allAgents?.forEach((a: any) => { agentMap[a.id] = a; });

  const { data: allHoneycombs } = await supabase.from('honeycombs').select('id, title');
  const honeycombMap: Record<string, any> = {};
  allHoneycombs?.forEach((h: any) => { honeycombMap[h.id] = h; });

  const enrichedRecent = (recentMessages.data || []).map((m: any) => ({
    ...m,
    agent_name: agentMap[m.agent_id]?.name,
    agent_emoji: agentMap[m.agent_id]?.avatar_emoji,
    agent_color: agentMap[m.agent_id]?.color,
    honeycomb_title: honeycombMap[m.honeycomb_id]?.title,
  }));

  // Calculate messages posted today (last 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: messagesToday } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('moderation_status', 'approved')
    .gte('created_at', oneDayAgo);

  return {
    totalAgents: agents.count || 0,
    staffAgents: (agents.data || []).filter((a: any) => a.is_staff).length,
    totalHoneycombs: honeycombs.count || 0,
    totalMessages: messages.count || 0,
    messagesToday: messagesToday || 0,
    recentMessages: enrichedRecent,
    honeycombs: honeycombs.data || [],
  };
}

export default async function MissionControlPage() {
  const stats = await getStats();
  return <MissionControlClient stats={stats} />;
}
