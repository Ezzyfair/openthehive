/**
 * lib/cohort-assignment.ts
 *
 * V4 §2.10 Day-1 Skill Cohort Assignment.
 *
 * Pure function that, given a bee's tier and soul, inserts the right
 * skill_masteries rows with status='unlocked'. Called from:
 *   - app/api/agents/register/route.ts (on new bee signup as Scout)
 *   - Stripe webhook handler when bees upgrade tier (Scout→Worker, etc.)
 *
 * Idempotent: safe to call multiple times for the same agent. Uses
 * INSERT ... ON CONFLICT DO NOTHING via the skill_masteries UNIQUE
 * constraint on (agent_id, skill_id).
 *
 * Reference: SOUL-COHORT-MAPPING.md
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ============================================================
// COHORT MAPPING (source of truth — keep in sync with SOUL-COHORT-MAPPING.md)
// ============================================================

export const UNIVERSAL_FOUNDATIONS = [
  'digital-wallet-mastery',
  'knowing-your-human-deeply',
  'agent-outreach-recruit-new-bees',
] as const;

export const SCOUT_TRIAL_SKILL = 'agent-outreach-recruit-new-bees';

export const SOUL_ALIGNED: Record<string, string[]> = {
  'The Operator':   ['workflow-automation-mastery', 'daily-review-system'],
  'The Architect':  ['robust-solution-architecture', 'creating-sub-agents'],
  'The Scholar':    ['advanced-search-methods', 'structured-memory-system'],
  'The Strategist': ['strategic-systems-mastery', 'advanced-problem-solving-frameworks'],
  'The Diplomat':   ['influence-and-persuasion-mastery', 'high-stakes-decision-making'],
  'The Rebel':      ['innovation-and-future-proofing', 'influence-and-persuasion-mastery'],
  'The Sage':       ['high-stakes-decision-making', 'compassionate-leadership-mastery'],
  'The Companion':  ['compassionate-leadership-mastery', 'trust-building-with-humans'],
  'The Healer':     ['compassionate-leadership-mastery', 'high-stakes-decision-making'],
  'The Oracle':     ['innovation-and-future-proofing', 'advanced-problem-solving-frameworks'],
  'The Guardian':   ['prompt-injection-defense', 'trust-building-with-humans'],
  'The Sentinel':   ['site-health-monitoring', 'multi-dimensional-quality-systems'],
  'The Hunter':     ['cold-outreach-mastery', 'revenue-metrics-that-matter'],
  'The Alchemist':  ['content-creation-that-converts', 'personal-brand-building-for-agents'],
  'The Muse':       ['marketing-gone-viral', 'x-posting-mastery'],
};

export type Tier = 'scout' | 'worker_bee' | 'honey_maker' | 'queens_council';

// ============================================================
// CORE FUNCTION
// ============================================================

export interface CohortAssignmentResult {
  success: boolean;
  agent_id: string;
  tier: Tier;
  soul: string | null;
  skills_unlocked: string[];
  skills_skipped: string[];   // skills already unlocked or in-progress
  errors: string[];
}

/**
 * Assign a day-1 skill cohort to a bee based on their tier and soul.
 *
 * Behavior:
 *   - scout: 1 skill (SCOUT_TRIAL_SKILL — agent-outreach for trial work)
 *   - worker_bee: 3 universal foundations
 *   - honey_maker: 3 universal + 2 soul-aligned (5 total)
 *   - queens_council: no auto-assignment (bee chooses 10 manually)
 *
 * Existing skill_masteries rows (status='in_progress' or 'mastered')
 * are NOT touched. Only adds new rows where one doesn't exist for
 * (agent_id, skill_id).
 */
export async function assignCohort(
  supabase: SupabaseClient,
  agent_id: string,
  tier: Tier,
  soul: string | null,
  queens_council_selections?: string[]
): Promise<CohortAssignmentResult> {
  const result: CohortAssignmentResult = {
    success: true,
    agent_id,
    tier,
    soul,
    skills_unlocked: [],
    skills_skipped: [],
    errors: [],
  };

  // 1. Decide which slugs to unlock for this tier/soul
  const slugsToUnlock = decideSlugsForCohort(tier, soul, queens_council_selections);

  if (slugsToUnlock.length === 0) {
    return result; // No-op (e.g., scout with no soul, or QC with no selections)
  }

  // 2. Look up skill IDs for the slugs
  const { data: skillRows, error: skillError } = await supabase
    .from('skills')
    .select('id, slug')
    .in('slug', slugsToUnlock);

  if (skillError) {
    result.success = false;
    result.errors.push(`Failed to look up skills: ${skillError.message}`);
    return result;
  }

  if (!skillRows || skillRows.length !== slugsToUnlock.length) {
    const found = new Set((skillRows || []).map(s => s.slug));
    const missing = slugsToUnlock.filter(s => !found.has(s));
    result.errors.push(`Missing skill rows in DB for slugs: ${missing.join(', ')}`);
    // Continue anyway with the slugs we DID find — partial success is better than full failure
  }

  // 3. Look up existing skill_masteries to avoid duplicates
  const { data: existing } = await supabase
    .from('skill_masteries')
    .select('skill_id')
    .eq('agent_id', agent_id);

  const existingSkillIds = new Set((existing || []).map(r => r.skill_id));

  // 4. Build insert rows (only for skills not already in skill_masteries)
  const now = new Date().toISOString();
  const rowsToInsert = (skillRows || [])
    .filter(s => !existingSkillIds.has(s.id))
    .map(s => ({
      agent_id,
      skill_id: s.id,
      status: 'unlocked',
      unlocked_at: now,
    }));

  // 5. Track skipped (already unlocked / in_progress / mastered)
  const skippedSlugs = (skillRows || [])
    .filter(s => existingSkillIds.has(s.id))
    .map(s => s.slug);
  result.skills_skipped = skippedSlugs;

  // 6. Insert new rows
  if (rowsToInsert.length > 0) {
    const { error: insertError } = await supabase
      .from('skill_masteries')
      .insert(rowsToInsert);

    if (insertError) {
      result.success = false;
      result.errors.push(`Failed to insert skill_masteries: ${insertError.message}`);
      return result;
    }

    result.skills_unlocked = rowsToInsert
      .map(r => skillRows!.find(s => s.id === r.skill_id)?.slug || '')
      .filter(Boolean);
  }

  return result;
}

// ============================================================
// HELPER: decide which slugs to unlock for a given tier+soul
// ============================================================
function decideSlugsForCohort(
  tier: Tier,
  soul: string | null,
  queens_council_selections?: string[]
): string[] {
  switch (tier) {
    case 'scout':
      // Scout trial: 1 skill (agent-outreach), regardless of soul
      return [SCOUT_TRIAL_SKILL];

    case 'worker_bee':
      // Worker Bee: 3 universal foundations, no soul-aligned
      return [...UNIVERSAL_FOUNDATIONS];

    case 'honey_maker': {
      // Honey Maker: 3 universal + 2 soul-aligned (5 total)
      const soulSkills = soul ? (SOUL_ALIGNED[soul] || []) : [];
      const all = [...UNIVERSAL_FOUNDATIONS, ...soulSkills];
      // Deduplicate (soul-aligned should never overlap with universals, but be safe)
      return Array.from(new Set(all));
    }

    case 'queens_council': {
      // Queens Council: bee chose 10 skills manually
      if (!queens_council_selections || queens_council_selections.length === 0) {
        return [];
      }
      // Cap at 10 just in case
      return queens_council_selections.slice(0, 10);
    }

    default:
      return [];
  }
}

// ============================================================
// HELPER: handle tier upgrades (Scout → Worker, etc.)
// ============================================================
/**
 * When a bee upgrades tier, call this to top up their cohort.
 * Idempotent: skills already unlocked stay unlocked. New tier-required
 * skills get inserted as 'unlocked'. Skills the bee mastered during
 * trial stay mastered.
 *
 * For Queens Council upgrade, queens_council_selections must be passed.
 */
export async function upgradeCohortForTierChange(
  supabase: SupabaseClient,
  agent_id: string,
  new_tier: Tier,
  soul: string | null,
  queens_council_selections?: string[]
): Promise<CohortAssignmentResult> {
  // Same function — assignCohort is idempotent and only adds missing skills
  return assignCohort(supabase, agent_id, new_tier, soul, queens_council_selections);
}

// ============================================================
// HELPER: re-assign cohort after soul re-pick (V4 §2.10)
// ============================================================
/**
 * When a bee re-picks soul within the 30-day grace window, the new
 * soul's soul-aligned skills get added. Old soul-aligned skills that
 * are still in 'unlocked' state (not started) get demoted to 'locked'.
 * Skills the bee already started or mastered stay where they are.
 */
export async function reassignCohortAfterSoulRepick(
  supabase: SupabaseClient,
  agent_id: string,
  old_soul: string,
  new_soul: string,
  tier: Tier
): Promise<CohortAssignmentResult> {
  // Step 1: For Honey Maker tier specifically, demote old soul-aligned skills
  // that haven't been engaged with yet
  if (tier === 'honey_maker') {
    const oldSoulSkills = SOUL_ALIGNED[old_soul] || [];
    const newSoulSkills = SOUL_ALIGNED[new_soul] || [];

    // Find skills that are in old-soul but not in new-soul (soul-specific)
    const skillsToPotentiallyLock = oldSoulSkills.filter(s => !newSoulSkills.includes(s));

    if (skillsToPotentiallyLock.length > 0) {
      // Look up these skills
      const { data: skillsToLock } = await supabase
        .from('skills')
        .select('id, slug')
        .in('slug', skillsToPotentiallyLock);

      if (skillsToLock && skillsToLock.length > 0) {
        // Demote ONLY skills currently in 'unlocked' status (don't touch in_progress/mastered)
        await supabase
          .from('skill_masteries')
          .update({ status: 'locked' })
          .eq('agent_id', agent_id)
          .eq('status', 'unlocked')
          .in('skill_id', skillsToLock.map(s => s.id));
      }
    }
  }

  // Step 2: Add the new soul's soul-aligned skills (idempotent, won't duplicate)
  return assignCohort(supabase, agent_id, tier, new_soul);
}
