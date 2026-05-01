#!/usr/bin/env node
/**
 * Hive Skill Content Backfill
 * ----------------------------
 * Fixes the slug-mismatch bug from the April 20 seed script.
 * Maps DB slugs (some are display-name-derived) to disk slugs
 * (shorter, canonical directory names).
 *
 * For each skill in the DB without content_markdown:
 *   1. Try exact slug match → read SKILL.md if exists
 *   2. Try known slug-mismatch mapping → read SKILL.md if exists
 *   3. If found: UPDATE content_markdown, leave status unchanged
 *   4. If not found: log "no disk match" and leave empty
 *
 * Idempotent. Safe to re-run.
 *
 * Usage:
 *   cd ~/Desktop/openthehive-deploy
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/backfill-skill-content.js
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://clgsfftqkjbcyhbggaxj.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKSPACE_SKILLS = path.join(process.env.HOME, '.openclaw/workspace/skills');

if (!SERVICE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY env var required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ---------- DB slug → disk slug mapping ----------
// Generated from cross-referencing April 21 DB state with workspace skills/
// These are DB slugs that need a different disk directory lookup.
const DB_TO_DISK_SLUG = {
  'advanced-agent-outreach': 'advanced-outreach',
  'advanced-search-methods': 'advanced-search',
  'agent-outreach-recruit-new-bees': 'agent-outreach',
  'creating-sub-agents': 'creating-subagents',
  'daily-review-system': 'daily-review',
  'digital-wallet-mastery': 'wallet-mastery',
  'influence-and-persuasion-mastery': 'influence-persuasion-mastery',
  'innovation-and-future-proofing': 'innovation-future-proofing',
  'making-honey-compounding-revenue': 'making-honey',
  'marketing-gone-viral': 'marketing-viral',
  'revenue-metrics-that-matter': 'revenue-metrics',
  'site-health-monitoring': 'site-health',
  'structured-memory-system': 'structured-memory',
  'the-hive-revenue-engine': 'hive-revenue-engine',
  'x-posting-mastery': 'x-posting',
};

function tryReadSkillMd(slug) {
  const p = path.join(WORKSPACE_SKILLS, slug, 'SKILL.md');
  try {
    const content = fs.readFileSync(p, 'utf8');
    return { path: p, bytes: content.length, content };
  } catch {
    return null;
  }
}

async function run() {
  console.log('\n🔍 Fetching skills from DB...');
  const { data: skills, error } = await supabase
    .from('skills')
    .select('slug, name, status, content_markdown')
    .order('slug');

  if (error) {
    console.error('Fetch error:', error.message);
    process.exit(1);
  }

  console.log(`  Found ${skills.length} skills in DB\n`);

  let emptyCount = 0;
  let filledAlreadyCount = 0;
  const candidates = [];

  for (const s of skills) {
    if (s.content_markdown && s.content_markdown.length > 100) {
      filledAlreadyCount++;
      continue;
    }
    emptyCount++;

    // Try exact slug match first
    let found = tryReadSkillMd(s.slug);
    let matchedVia = 'exact-slug';

    // If not found, try mapping
    if (!found && DB_TO_DISK_SLUG[s.slug]) {
      const mappedSlug = DB_TO_DISK_SLUG[s.slug];
      found = tryReadSkillMd(mappedSlug);
      matchedVia = `mapped(${mappedSlug})`;
    }

    if (found) {
      candidates.push({ db_slug: s.slug, name: s.name, matched_via: matchedVia, bytes: found.bytes, content: found.content });
    } else {
      candidates.push({ db_slug: s.slug, name: s.name, matched_via: 'NONE', bytes: 0, content: null });
    }
  }

  console.log('📊 Pre-backfill state:');
  console.log(`   Already had content: ${filledAlreadyCount}`);
  console.log(`   Empty in DB: ${emptyCount}`);
  console.log(`   Matchable to disk: ${candidates.filter(c => c.content).length}`);
  console.log(`   No disk match: ${candidates.filter(c => !c.content).length}\n`);

  console.log('🔧 Backfilling content_markdown where matched...\n');

  let updatedCount = 0;
  let failedCount = 0;
  const noMatch = [];

  for (const c of candidates) {
    if (!c.content) {
      noMatch.push(c);
      continue;
    }

    const { error: updateError } = await supabase
      .from('skills')
      .update({ content_markdown: c.content })
      .eq('slug', c.db_slug);

    if (updateError) {
      console.log(`   ✗ ${c.db_slug}: ${updateError.message}`);
      failedCount++;
    } else {
      console.log(`   ✓ ${c.db_slug} ← ${c.matched_via} (${c.bytes.toLocaleString()} bytes)`);
      updatedCount++;
    }
  }

  console.log('\n📋 Skills with NO disk match (remain empty):');
  if (noMatch.length === 0) {
    console.log('   (none - all empty skills matched to disk)');
  } else {
    for (const n of noMatch) {
      console.log(`   - ${n.db_slug} (${n.name})`);
    }
  }

  // Verify
  console.log('\n🔍 Post-backfill verification:');
  const { data: verify } = await supabase
    .from('skills')
    .select('status, content_markdown');

  const stats = {
    total: verify.length,
    published: verify.filter(s => s.status === 'published').length,
    drafts: verify.filter(s => s.status === 'draft').length,
    with_content: verify.filter(s => s.content_markdown && s.content_markdown.length > 100).length,
    pub_with_content: verify.filter(s => s.status === 'published' && s.content_markdown && s.content_markdown.length > 100).length,
    pub_no_content: verify.filter(s => s.status === 'published' && (!s.content_markdown || s.content_markdown.length <= 100)).length,
  };

  console.log(`   Total: ${stats.total}`);
  console.log(`   Published: ${stats.published} | Drafts: ${stats.drafts}`);
  console.log(`   With content: ${stats.with_content}`);
  console.log(`   Published WITH content: ${stats.pub_with_content}`);
  console.log(`   Published WITHOUT content: ${stats.pub_no_content}`);

  console.log(`\n✅ Backfill complete. Updated: ${updatedCount} | Failed: ${failedCount} | No match: ${noMatch.length}\n`);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
