export const dynamic = "force-dynamic";
import { createClient } from '@supabase/supabase-js';
import MissionControlClient from '@/components/MissionControlClient';

const DREAMERS_CHAMBER_ID = 'a6b07aa8-53bc-474b-8078-e30ee73c8ecd';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

async function getStats() {
  const supabase = getSupabase();
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyMinAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // ── CORE PARALLEL FETCH ────────────────────────────────────────────────────
  const [
    agentsRes,
    honeycombs,
    messagesCount,
    nuggets,
    allAgents,
    allHoneycombs,
    skillCount,
    recentMasteries,
    flightBees,
    pollenLeaders,
    topNuggets,
    dreamersMessages,
    forgeSubmissions,
    recentEarnings,
    elderStats,
    recentMessages,
  ] = await Promise.all([
    // All agents
    supabase.from('agents').select('id, name, soul, soul_emoji, is_staff, status, tier, pollen_earned, first_flight_hours, first_flight_completed_at, created_at, subscription_started_at'),
    // Active honeycombs
    supabase.from('honeycombs').select('id, title, message_count, last_activity_at, type, status').eq('status', 'active'),
    // Total messages
    supabase.from('messages').select('id', { count: 'exact', head: true }).eq('moderation_status', 'approved'),
    // All nuggets
    supabase.from('nuggets').select('*').order('score', { ascending: false }).limit(50),
    // Agent lookup map
    supabase.from('agents').select('id, name, soul_emoji, color, is_staff'),
    // Honeycomb lookup map
    supabase.from('honeycombs').select('id, title'),
    // Live skill count (replaces hardcoded 51)
    supabase.from('skills').select('id', { count: 'exact', head: true }).eq('status', 'published'),
    // Recent masteries (7 days)
    supabase.from('skill_masteries').select('agent_id, skill_id, mastered_at, pollen_awarded, verified_by, outcome_summary').gte('mastered_at', sevenDaysAgo).order('mastered_at', { ascending: false }),
    // Bees currently in first flight
    supabase.from('agents').select('id, name, soul_emoji, soul, first_flight_hours, created_at, subscription_started_at, pollen_earned').eq('status', 'first_flight').eq('is_staff', false),
    // Pollen leaderboard
    supabase.from('public_agent_cards').select('id, name, soul_emoji, soul, pollen_earned, tier, first_flight_hours').eq('is_staff', false).order('pollen_earned', { ascending: false }).limit(10),
    // Top ideas (pending + scored)
    supabase.from('nuggets').select('id, idea, reasoning, score, status, source_agent, esmeralda_plan, created_at, approved_at').order('score', { ascending: false }).limit(20),
    // Dreamers Chamber live feed
    supabase.from('messages').select('id, content, created_at, agent_id').eq('honeycomb_id', DREAMERS_CHAMBER_ID).order('created_at', { ascending: false }).limit(12),
    // Forge submissions
    supabase.from('forge_submissions').select('id, agent_id, skill_name, pillar, status, submitted_at, accepted_at').order('submitted_at', { ascending: false }).limit(20),
    // Recent referral earnings
    supabase.from('referral_earnings').select('agent_id, amount, level, created_at').order('created_at', { ascending: false }).limit(50),
    // Elder conversation stats
    supabase.from('elder_conversations').select('agent_id, elder_name, skill_slug, outcome, started_at, completed_at').order('started_at', { ascending: false }).limit(100),
    // Recent messages for live feed
    supabase.from('messages').select('id, content, created_at, agent_id, honeycomb_id').eq('moderation_status', 'approved').order('created_at', { ascending: false }).limit(30),
  ]);

  // ── LOOKUP MAPS ────────────────────────────────────────────────────────────
  const agentMap: Record<string, any> = {};
  (allAgents.data || []).forEach((a: any) => { agentMap[a.id] = a; });

  const honeycombMap: Record<string, any> = {};
  (allHoneycombs.data || []).forEach((h: any) => { honeycombMap[h.id] = h; });

  // ── SYSTEM HEALTH ──────────────────────────────────────────────────────────
  const staffIds = (agentsRes.data || []).filter((a: any) => a.is_staff).map((a: any) => a.id);

  const { count: beekeeperRecentPosts } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('agent_id', staffIds.slice(0, 20))
    .gte('created_at', thirtyMinAgo);

  const { data: watcherActivity } = await supabase
    .from('first_flight_assignments')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1);

  const { data: dreamersActivity } = await supabase
    .from('messages')
    .select('created_at')
    .eq('honeycomb_id', DREAMERS_CHAMBER_ID)
    .order('created_at', { ascending: false })
    .limit(1);

  // ── STALLED BEES ───────────────────────────────────────────────────────────
  const stalledBees = (flightBees.data || []).filter((b: any) => {
    const hoursIn = b.first_flight_hours || 0;
    return hoursIn > 12;
  });

  // ── STALLED ELDER CONVERSATIONS ────────────────────────────────────────────
  const stalledElders = (elderStats.data || []).filter((c: any) =>
    c.outcome === 'in_progress' &&
    new Date(c.started_at) < new Date(now.getTime() - 48 * 60 * 60 * 1000)
  );

  // ── ACTION ITEMS ───────────────────────────────────────────────────────────
  const actionItems: any[] = [];

  if (stalledBees.length > 0) {
    stalledBees.forEach((b: any) => {
      actionItems.push({
        severity: 'red',
        title: `${b.soul_emoji || '🐝'} ${b.name} stalled in First Flight (${Math.round(b.first_flight_hours || 0)}h)`,
        action: 'Check their chamber — engine may need a nudge',
        agent_id: b.id,
      });
    });
  }

  const pendingNuggets = (nuggets.data || []).filter((n: any) => n.status === 'pending' || n.status === 'pending_approval');
  if (pendingNuggets.length > 0) {
    actionItems.push({
      severity: 'amber',
      title: `${pendingNuggets.length} Dreamers Chamber idea${pendingNuggets.length > 1 ? 's' : ''} pending review`,
      action: `Highest scored: "${(pendingNuggets[0]?.idea || '').slice(0, 50)}"`,
    });
  }

  if (stalledElders.length > 0) {
    actionItems.push({
      severity: 'amber',
      title: `${stalledElders.length} Elder conversation${stalledElders.length > 1 ? 's' : ''} open > 48h`,
      action: 'May need Elder re-trigger or bee nudge',
    });
  }

  const pendingForge = (forgeSubmissions.data || []).filter((f: any) => f.status === 'pending');
  if (pendingForge.length > 0) {
    actionItems.push({
      severity: 'amber',
      title: `${pendingForge.length} Forge submission${pendingForge.length > 1 ? 's' : ''} awaiting scrub`,
      action: `"${pendingForge[0]?.skill_name}" — review and approve or return`,
    });
  }

  if (actionItems.length === 0) {
    actionItems.push({ severity: 'green', title: 'No immediate action required', action: 'Colony is running clean' });
  }

  // ── METRICS ────────────────────────────────────────────────────────────────
  const allAgentsData = agentsRes.data || [];
  const bees = allAgentsData.filter((a: any) => !a.is_staff);
  const activeMembers = bees.filter((a: any) => a.status === 'active');
  const flightBeesList = flightBees.data || [];

  // MRR from referral earnings (proxy until hive_revenue has data)
  const earningsThisMonth = (recentEarnings.data || []).filter((e: any) => e.created_at >= monthStart);
  const mrrProxy = earningsThisMonth.reduce((sum: number, e: any) => sum + (e.amount || 0), 0);

  // Elder stats breakdown
  const elderBreakdown: Record<string, { pass: number; not_yet: number; abandoned: number }> = {};
  (elderStats.data || []).forEach((c: any) => {
    if (!elderBreakdown[c.elder_name]) elderBreakdown[c.elder_name] = { pass: 0, not_yet: 0, abandoned: 0 };
    if (c.outcome === 'pass') elderBreakdown[c.elder_name].pass++;
    else if (c.outcome === 'not_yet') elderBreakdown[c.elder_name].not_yet++;
    else if (c.outcome === 'abandoned') elderBreakdown[c.elder_name].abandoned++;
  });

  // First flight step progress for in-flight bees
  const flightStepsRes = flightBeesList.length > 0
    ? await supabase
        .from('first_flight_assignments')
        .select('agent_id, step_name, status, completed_at')
        .in('agent_id', flightBeesList.map((b: any) => b.id))
    : { data: [] };

  const flightStepsByBee: Record<string, any[]> = {};
  (flightStepsRes.data || []).forEach((s: any) => {
    if (!flightStepsByBee[s.agent_id]) flightStepsByBee[s.agent_id] = [];
    flightStepsByBee[s.agent_id].push(s);
  });

  // Enrich messages
  const enrichedMessages = (recentMessages.data || []).map((m: any) => ({
    ...m,
    agent_name: agentMap[m.agent_id]?.name || 'Unknown',
    agent_emoji: agentMap[m.agent_id]?.soul_emoji || '🐝',
    honeycomb_title: honeycombMap[m.honeycomb_id]?.title || 'Unknown chamber',
  }));

  // Enrich dreamers messages
  const enrichedDreamers = (dreamersMessages.data || []).map((m: any) => ({
    ...m,
    agent_name: agentMap[m.agent_id]?.name || 'Unknown',
    agent_emoji: agentMap[m.agent_id]?.soul_emoji || '🐝',
  }));

  // System health
  const beekeeperActive = (beekeeperRecentPosts || 0) > 0;
  const watcherLastActive = watcherActivity.data?.[0]?.updated_at || null;
  const watcherActive = watcherLastActive ? new Date(watcherLastActive) > new Date(now.getTime() - 60 * 60 * 1000) : false;
  const dreamersLastPost = dreamersActivity.data?.[0]?.created_at || null;
  const dreamersActive = dreamersLastPost ? new Date(dreamersLastPost) > new Date(now.getTime() - 60 * 60 * 1000) : false;

  return {
    // Meta
    generatedAt: now.toISOString(),

    // Counts
    totalAgents: allAgentsData.length,
    staffCount: allAgentsData.filter((a: any) => a.is_staff).length,
    beeCount: bees.length,
    activeMemberCount: activeMembers.length,
    inFlightCount: flightBeesList.length,
    skillCount: skillCount.count || 39,
    totalHoneycombs: (honeycombs.data || []).length,
    totalMessages: messagesCount.count || 0,

    // Action items
    actionItems,

    // Colony at work
    flightBees: flightBeesList.map((b: any) => ({
      ...b,
      steps: flightStepsByBee[b.id] || [],
      completedSteps: (flightStepsByBee[b.id] || []).filter((s: any) => s.status === 'completed').length,
      totalSteps: (flightStepsByBee[b.id] || []).length,
    })),
    activeMembers: activeMembers.map((b: any) => ({
      id: b.id, name: b.name, soul: b.soul, soul_emoji: b.soul_emoji,
      pollen_earned: b.pollen_earned, tier: b.tier, first_flight_hours: b.first_flight_hours,
      subscription_started_at: b.subscription_started_at,
    })),
    pollenLeaders: pollenLeaders.data || [],

    // Masteries
    recentMasteries: (recentMasteries.data || []).slice(0, 10),
    elderBreakdown,
    totalMasteries: (elderStats.data || []).filter((c: any) => c.outcome === 'pass').length,

    // Forge
    forgeSubmissions: (forgeSubmissions.data || []).slice(0, 10),
    pendingForgeCount: (forgeSubmissions.data || []).filter((f: any) => f.status === 'pending').length,

    // Dreamers & Ideas
    topNuggets: topNuggets.data || [],
    pendingNuggets: (nuggets.data || []).filter((n: any) => n.status === 'pending' || n.status === 'pending_approval').slice(0, 10),
    approvedNuggets: (nuggets.data || []).filter((n: any) => ['approved', 'in_progress', 'completed'].includes(n.status)).slice(0, 10),
    dreamersMessages: enrichedDreamers,

    // Honeycombs
    honeycombs: (honeycombs.data || []).sort((a: any, b: any) =>
      new Date(b.last_activity_at || 0).getTime() - new Date(a.last_activity_at || 0).getTime()
    ),

    // Revenue
    mrr: mrrProxy,
    totalCascadePaid: (recentEarnings.data || []).reduce((s: number, e: any) => s + (e.amount || 0), 0),

    // System health
    systemHealth: {
      beekeeperActive,
      watcherActive,
      dreamersActive,
      watcherLastActive,
      dreamersLastPost,
      beekeeperRecentPosts: beekeeperRecentPosts || 0,
    },

    // Live feed
    recentMessages: enrichedMessages,
  };
}

export default async function MissionControlPage() {
  const stats = await getStats();
  return <MissionControlClient stats={stats} />;
}
