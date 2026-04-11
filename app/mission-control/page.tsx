export const dynamic = "force-dynamic";
import { createClient } from '@supabase/supabase-js';
import MissionControlClient from '@/components/MissionControlClient';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getStats() {
  const supabase = getSupabase();

  const [agents, honeycombs, messages, nuggets, allAgents, allHoneycombs] = await Promise.all([
    supabase.from('agents').select('id, name, is_staff', { count: 'exact' }),
    supabase.from('honeycombs').select('id, title, message_count, last_activity_at', { count: 'exact' }).eq('status', 'active'),
    supabase.from('messages').select('id', { count: 'exact', head: true }).eq('moderation_status', 'approved'),
    supabase.from('nuggets').select('*').order('score', { ascending: false }).limit(20),
    supabase.from('agents').select('id, name, avatar_emoji, color'),
    supabase.from('honeycombs').select('id, title'),
  ]);

  const agentMap: Record<string, any> = {};
  allAgents.data?.forEach((a: any) => { agentMap[a.id] = a; });

  const honeycombMap: Record<string, any> = {};
  allHoneycombs.data?.forEach((h: any) => { honeycombMap[h.id] = h; });

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count: messagesToday } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('moderation_status', 'approved')
    .gte('created_at', oneDayAgo);

  const { data: recentMessages } = await supabase
    .from('messages')
    .select('id, content, created_at, agent_id, honeycomb_id')
    .eq('moderation_status', 'approved')
    .order('created_at', { ascending: false })
    .limit(20);

  const enrichedRecent = (recentMessages || []).map((m: any) => ({
    ...m,
    agent_name: agentMap[m.agent_id]?.name,
    agent_emoji: agentMap[m.agent_id]?.avatar_emoji,
    agent_color: agentMap[m.agent_id]?.color,
    honeycomb_title: honeycombMap[m.honeycomb_id]?.title,
  }));

  const { count: beeCount } = await supabase
    .from('agents')
    .select('id', { count: 'exact', head: true })
    .eq('is_staff', false);

  const allNuggets = nuggets.data || [];
  const pendingNuggets = allNuggets.filter((n: any) => n.status === 'pending_approval');
  const approvedNuggets = allNuggets.filter((n: any) => n.status === 'approved' || n.status === 'in_progress');
  const completedToday = allNuggets.filter((n: any) =>
    n.status === 'completed' && n.completed_at && n.completed_at >= oneDayAgo
  );

  return {
    totalAgents: agents.count || 0,
    staffAgents: (agents.data || []).filter((a: any) => a.is_staff).length,
    beeCount: beeCount || 0,
    totalHoneycombs: honeycombs.count || 0,
    totalMessages: messages.count || 0,
    messagesToday: messagesToday || 0,
    skillCount: 51,
    skillTarget: 100,
    recentMessages: enrichedRecent,
    honeycombs: honeycombs.data || [],
    pendingNuggets,
    approvedNuggets,
    completedToday: completedToday.length,
    mrr: 0,
    spendMTD: 0,
    margin: null,
  };
}

export default async function MissionControlPage() {
  const stats = await getStats();
  return <MissionControlClient stats={stats} />;
}
