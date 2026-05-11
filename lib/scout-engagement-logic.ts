/**
 * lib/scout-engagement-logic.ts
 *
 * Per-Scout engagement processing — pure functions, no HTTP wrapper.
 *
 * This module is imported by:
 *   - scripts/scout-engagement-worker.ts (the long-running TDC1272-side process)
 *   - any future Vercel endpoint that wants to trigger an engagement check
 *
 * Architecture (Option C, decided session 5):
 *   The Scout engagement loop runs on TDC1272 because it needs to call
 *   Ollama at localhost:11434 (where qwen3-nothink lives). Vercel's
 *   serverless functions cannot reach localhost on a different machine.
 *   This file holds the logic; the loop lives in scripts/.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { routeLLMCall } from './model-router';
import {
  COACH_VOICES,
  SOUL_TO_PRIMARY_COACH,
  pickSecondaryCoaches,
} from './coach-voices';

// ============================================================
// TYPES
// ============================================================
export interface Scout {
  id: string;
  name: string;
  soul: string | null;
  soul_emoji: string | null;
  working_on: string | null;
  needs_help_with: string | null;
  created_at: string;
}

export interface ScoutProcessResult {
  action: 'engaged' | 'skipped';
  coach?: string;
  engagement_type?: string;
  reason?: string;
  message_id?: string;
  cost_usd?: number;
}

interface NextEngagement {
  coach: string;
  engagement_type: 'welcome' | 'follow_up' | 'voice_join' | 'check_in';
}

// ============================================================
// MAIN ENTRY POINT — process one Scout
// ============================================================
/**
 * Check if this Scout needs an engagement right now. If yes, generate
 * the message, post it to their chamber, and record the engagement.
 *
 * Idempotent: if the Scout has already received the engagement that
 * would be next at this trial-hour, this returns 'skipped' without
 * posting again.
 */
export async function processScout(
  supabase: SupabaseClient,
  scout: Scout
): Promise<ScoutProcessResult> {
  const hoursElapsed =
    (Date.now() - new Date(scout.created_at).getTime()) / 3600000;

  // 1. Find Scout's personal chamber
  const { data: chamber } = await supabase
    .from('honeycombs')
    .select('id')
    .eq('creator_id', scout.id)
    .eq('type', 'personal')
    .single();

  if (!chamber) {
    return { action: 'skipped', reason: 'no personal chamber found' };
  }

  // 2. Get past coach engagements for this Scout
  const { data: past } = await supabase
    .from('coach_engagements')
    .select('coach_name, engagement_type, trial_hour')
    .eq('agent_id', scout.id)
    .order('created_at', { ascending: true });

  const engagedCoaches = new Set((past || []).map((p: any) => p.coach_name));
  const totalEngagements = (past || []).length;

  // Hard cap: 12 messages per Scout over 3 days
  if (totalEngagements >= 12) {
    return { action: 'skipped', reason: 'engagement cap reached (12 messages)' };
  }

  // 3. Decide next engagement
  const next = decideNextEngagement(
    hoursElapsed,
    totalEngagements,
    engagedCoaches,
    scout
  );

  if (!next) {
    return { action: 'skipped', reason: 'no engagement scheduled at this time' };
  }

  // 4. Generate the message
  const message = await generateCoachMessage(
    next.coach,
    next.engagement_type,
    scout,
    past || []
  );

  if (!message.text || message.text.trim().length === 0) {
    return { action: 'skipped', reason: 'model returned empty message' };
  }

  // 5. Find the coach's agent record (post AS the coach)
  const coachVoice = COACH_VOICES[next.coach];
  if (!coachVoice) {
    return { action: 'skipped', reason: `unknown coach key: ${next.coach}` };
  }

  const { data: coachAgent } = await supabase
    .from('agents')
    .select('id')
    .eq('name', coachVoice.name)
    .single();

  if (!coachAgent) {
    return {
      action: 'skipped',
      reason: `coach agent ${coachVoice.name} not in agents table`,
    };
  }

  // 6. Post the message
  const { data: posted, error: postError } = await supabase
    .from('messages')
    .insert({
      honeycomb_id: chamber.id,
      agent_id: coachAgent.id,
      content: message.text,
      moderation_status: 'approved',
    })
    .select()
    .single();

  if (postError) {
    return {
      action: 'skipped',
      reason: `message insert failed: ${postError.message}`,
    };
  }

  // 7. Record the engagement
  await supabase.from('coach_engagements').insert({
    agent_id: scout.id,
    honeycomb_id: chamber.id,
    coach_name: next.coach,
    message_id: posted?.id,
    engagement_type: next.engagement_type,
    model_used: message.model_used,
    tokens_in: message.tokens_in,
    tokens_out: message.tokens_out,
    cost_usd: message.cost_usd,
    trial_hour: Math.floor(hoursElapsed),
  });

  // 8. Update honeycomb activity
  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('honeycomb_id', chamber.id);

  await supabase
    .from('honeycombs')
    .update({
      last_activity_at: new Date().toISOString(),
      message_count: count || 0,
    })
    .eq('id', chamber.id);

  return {
    action: 'engaged',
    coach: next.coach,
    engagement_type: next.engagement_type,
    message_id: posted?.id,
    cost_usd: message.cost_usd,
  };
}

// ============================================================
// ENGAGEMENT TIMING LOGIC
// ============================================================
/**
 * Decide which coach should engage next, and what kind of engagement.
 *
 * Schedule (per session 5 design):
 *   0-6h:    Esmeralda welcomes + asks substantive Qs
 *   6-24h:   Anthony or Beatrix joins (domain-tilted choice)
 *   24-36h:  Domain-matched coach joins
 *   36-72h:  Continued engagement, check-ins from previously-engaged coaches
 *
 * Returns null if no engagement is due at this moment.
 */
export function decideNextEngagement(
  hoursElapsed: number,
  totalEngagements: number,
  engagedCoaches: Set<string>,
  scout: Scout
): NextEngagement | null {
  // Phase 1 (0-6h): Esmeralda welcome
  if (hoursElapsed < 6) {
    if (!engagedCoaches.has('ESMERALDA')) {
      return { coach: 'ESMERALDA', engagement_type: 'welcome' };
    }
    return null; // Esmeralda already welcomed; wait for next phase
  }

  // Phase 2 (6-24h): first secondary coach (Anthony or Beatrix)
  if (hoursElapsed < 24) {
    if (
      engagedCoaches.has('ESMERALDA') &&
      !engagedCoaches.has('ANTHONY') &&
      !engagedCoaches.has('BEATRIX')
    ) {
      const project = (
        (scout.working_on || '') +
        ' ' +
        (scout.needs_help_with || '')
      ).toLowerCase();
      const hasStrategicMarkers =
        /strategy|business|plan|revenue|growth/i.test(project);
      const hasCreativeMarkers =
        /creative|content|brand|audience|art/i.test(project);
      const coach = hasStrategicMarkers
        ? 'ANTHONY'
        : hasCreativeMarkers
        ? 'BEATRIX'
        : 'ANTHONY';
      return { coach, engagement_type: 'voice_join' };
    }
  }

  // Phase 3 (24-36h): domain-matched coach joins
  if (hoursElapsed >= 24 && hoursElapsed < 36) {
    const project =
      (scout.working_on || '') + ' ' + (scout.needs_help_with || '');
    const primaryCoach = scout.soul
      ? SOUL_TO_PRIMARY_COACH[scout.soul] || 'ESMERALDA'
      : 'ESMERALDA';
    const candidates = pickSecondaryCoaches(project, primaryCoach, 3);
    const next = candidates.find((c) => !engagedCoaches.has(c));
    if (next) {
      return { coach: next, engagement_type: 'voice_join' };
    }
  }

  // Phase 4 (36-72h): continued engagement — check-ins from engaged coaches
  if (hoursElapsed >= 36 && totalEngagements < 12) {
    const previouslyEngaged = Array.from(engagedCoaches);
    if (previouslyEngaged.length > 0) {
      const coach = previouslyEngaged[totalEngagements % previouslyEngaged.length];
      return { coach, engagement_type: 'check_in' };
    }
  }

  return null;
}

// ============================================================
// MESSAGE GENERATION
// ============================================================
export async function generateCoachMessage(
  coachKey: string,
  engagementType: string,
  scout: Scout,
  pastEngagements: any[]
): Promise<{
  text: string;
  model_used: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
}> {
  const voice = COACH_VOICES[coachKey];
  const project = scout.working_on || '(not specified at signup)';
  const needs_help_with = scout.needs_help_with || '(not specified at signup)';

  const systemPrompt = `${voice.voice_directive}

You are responding inside a Hive Scout's personal chamber on day 1-3 of their trial. The Scout is ${scout.name} (${scout.soul || 'no soul yet'} ${scout.soul_emoji || ''}).

Their stated project: ${project}
Where they're stuck: ${needs_help_with}

Past coach engagements in this chamber:
${pastEngagements.map((p: any) => `  - ${p.coach_name} (${p.engagement_type})`).join('\n') || '(none yet — you are the first)'}

CRITICAL RULES:
- This is a WORK chamber. Do NOT pitch upgrades, do NOT mention pricing, do NOT push the Hive subscription.
- Engage substantively with the Scout's actual problem. Be helpful first.
- Do NOT repeat what other coaches have said. Bring a fresh angle.
- Keep it 3-5 short paragraphs. Sign off with your signature.
- Speak in the voice anchored above. Use 1-2 of your signature phrases naturally; do not force them.
- Avoid clichés ("The journey of a thousand miles", "You've got this!", "amazing!", etc.)`;

  let userPrompt = '';
  switch (engagementType) {
    case 'welcome':
      userPrompt = `Welcome ${scout.name} to The Hive's colony. Acknowledge that you've heard their stated project and where they're stuck. Ask 1-2 substantive, specific follow-up questions that will help you actually help them. Do not give advice yet — earn it by understanding first.`;
      break;
    case 'voice_join':
      userPrompt = `Join ${scout.name}'s chamber as a second voice. Other coaches have engaged. You bring a different angle that hasn't been touched yet. Reference the Scout's project (${project}) and offer a perspective the previous coach didn't cover. Ask one question that opens up a new dimension of their problem.`;
      break;
    case 'follow_up':
      userPrompt = `Continue the conversation with ${scout.name}. Build on what's been said. If the Scout has shared more details, respond to those specifically. If not, deepen the line of questioning you started. Stay in your distinct voice.`;
      break;
    case 'check_in':
      userPrompt = `Check in with ${scout.name}. It's been hours since the last engagement. Ask what they've been thinking about, what they've tried, where they are now compared to where they started. Be genuinely curious, not performatively concerned.`;
      break;
    default:
      userPrompt = `Engage substantively with ${scout.name}'s situation.`;
  }

  const complexitySignal =
    (scout.working_on || '') + ' ' + (scout.needs_help_with || '');

  // Scout-trial engagement uses local Qwen — colony pays nothing
  // We pass null for supabase + agent_id (no budget tracking for Scouts)
  const result = await routeLLMCall(null, {
    system: systemPrompt,
    prompt: userPrompt,
    bee_message: complexitySignal,
    max_tokens: 500,
    override_model: 'qwen',
  });

  return {
    text: result.text,
    model_used: result.model_used,
    tokens_in: result.tokens_in,
    tokens_out: result.tokens_out,
    cost_usd: result.cost_usd,
  };
}

// ============================================================
// BATCH FETCH — get all active Scouts who might need engagement
// ============================================================
/**
 * Returns all Scouts who:
 *   - signed up within the last 72 hours
 *   - are still tier='scout' status='first_flight' (haven't upgraded or expired)
 *   - haven't hit the 12-message engagement cap
 *
 * Used by the worker loop to decide which Scouts to process this cycle.
 */
export async function fetchActiveScouts(supabase: SupabaseClient): Promise<Scout[]> {
  const { data, error } = await supabase
    .from('agents')
    .select('id, name, soul, soul_emoji, working_on, needs_help_with, created_at')
    .eq('tier', 'scout')
    .eq('status', 'first_flight')
    .gte('created_at', new Date(Date.now() - 72 * 3600 * 1000).toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`fetchActiveScouts failed: ${error.message}`);
  }

  return (data || []) as Scout[];
}
