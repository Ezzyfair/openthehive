#!/usr/bin/env node

/**
 * backfill-soul-content.js
 *
 * Reads soul .md files from ~/Desktop/Skills/souls/ and populates the
 * souls.content_markdown column in Supabase for each matching slug.
 *
 * Idempotent — safe to re-run. Re-processes every file on each invocation.
 *
 * Usage:
 *   cd ~/Desktop/openthehive-deploy
 *   source .env.local
 *   SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY \
 *     node scripts/backfill-soul-content.js
 *
 * Slug mapping: filename minus .md (e.g. "the-operator.md" -> slug "the-operator").
 * If filenames don't match DB slugs (which session-3 handoff says they do),
 * mismatches will be reported and you can add an entry to SLUG_MAP below.
 *
 * Authored: Session 4, April 26, 2026
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { createClient } = require('@supabase/supabase-js');

// --- Config ---
const SOULS_DIR = path.join(os.homedir(), 'Desktop', 'Skills', 'souls');
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MIN_CONTENT_BYTES = 1000; // soul docs should be 15KB+; anything under 1KB is suspect

// Optional: add filename->DB-slug overrides here if mismatches show up.
// Example:  'the-rebel': 'the_rebel'
const SLUG_MAP = {};

// --- Validation ---
if (!SUPABASE_URL) {
  console.error('NEXT_PUBLIC_SUPABASE_URL not set. Did you `source .env.local`?');
  process.exit(1);
}
if (!SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY not set. Run with:');
  console.error('  SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY node scripts/backfill-soul-content.js');
  process.exit(1);
}
if (!fs.existsSync(SOULS_DIR)) {
  console.error(`Souls directory not found: ${SOULS_DIR}`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

// --- Main ---
async function main() {
  console.log('Soul content backfill starting...');
  console.log(`  Source: ${SOULS_DIR}`);
  console.log(`  Target: ${SUPABASE_URL}`);
  console.log('');

  // Discover .md files
  const files = fs.readdirSync(SOULS_DIR)
    .filter(f => f.endsWith('.md') && !f.startsWith('.'))
    .sort();

  if (files.length === 0) {
    console.error(`No .md files found in ${SOULS_DIR}.`);
    process.exit(1);
  }

  console.log(`Found ${files.length} soul .md files on disk.`);

  // Fetch existing soul rows from DB
  const { data: existingSouls, error: fetchError } = await supabase
    .from('souls')
    .select('slug, name, content_markdown');

  if (fetchError) {
    console.error('Failed to fetch souls from DB:', fetchError.message);
    process.exit(1);
  }

  const dbSlugs = new Set(existingSouls.map(s => s.slug));
  console.log(`DB has ${existingSouls.length} soul rows.`);
  console.log(`DB slugs: ${[...dbSlugs].sort().join(', ')}`);
  console.log('');

  // Track results
  const results = {
    updated: [],
    skipped_no_match: [],
    skipped_too_small: [],
    failed: []
  };

  // Process each file
  for (const file of files) {
    const filenameSlug = file.replace(/\.md$/, '');
    const dbSlug = SLUG_MAP[filenameSlug] || filenameSlug;
    const filePath = path.join(SOULS_DIR, file);
    const content = fs.readFileSync(filePath, 'utf8');
    const bytes = Buffer.byteLength(content, 'utf8');

    if (!dbSlugs.has(dbSlug)) {
      console.log(`SKIP  ${dbSlug.padEnd(28)} no matching DB row`);
      results.skipped_no_match.push(filenameSlug);
      continue;
    }

    if (bytes < MIN_CONTENT_BYTES) {
      console.log(`SKIP  ${dbSlug.padEnd(28)} content only ${bytes} bytes (below ${MIN_CONTENT_BYTES} threshold)`);
      results.skipped_too_small.push({ slug: dbSlug, bytes });
      continue;
    }

    const { error: updateError } = await supabase
      .from('souls')
      .update({ content_markdown: content, updated_at: new Date().toISOString() })
      .eq('slug', dbSlug);

    if (updateError) {
      console.log(`FAIL  ${dbSlug.padEnd(28)} ${updateError.message}`);
      results.failed.push({ slug: dbSlug, error: updateError.message });
      continue;
    }

    console.log(`OK    ${dbSlug.padEnd(28)} ${bytes.toLocaleString()} bytes uploaded`);
    results.updated.push({ slug: dbSlug, bytes });
  }

  // Summary
  console.log('');
  console.log('--------------------------------------------------');
  console.log('SUMMARY');
  console.log('--------------------------------------------------');
  console.log(`  Updated:             ${results.updated.length}`);
  console.log(`  Skipped (no match):  ${results.skipped_no_match.length}`);
  console.log(`  Skipped (too small): ${results.skipped_too_small.length}`);
  console.log(`  Failed:              ${results.failed.length}`);

  if (results.skipped_no_match.length > 0) {
    console.log('');
    console.log('Files with no DB match (add to SLUG_MAP if needed):');
    results.skipped_no_match.forEach(s => console.log(`  - ${s}.md`));
  }

  if (results.failed.length > 0) {
    console.log('');
    console.log('Failed updates:');
    results.failed.forEach(f => console.log(`  - ${f.slug}: ${f.error}`));
  }

  // Final verification
  console.log('');
  const { data: verify, error: verifyError } = await supabase
    .from('souls')
    .select('slug, content_markdown');

  if (verifyError) {
    console.log(`Could not verify final count: ${verifyError.message}`);
  } else {
    const withContent = verify.filter(s => s.content_markdown && s.content_markdown.length > 100);
    const withoutContent = verify.filter(s => !s.content_markdown || s.content_markdown.length <= 100);
    console.log(`Souls with content_markdown in DB: ${withContent.length} / ${verify.length}`);
    if (withoutContent.length > 0) {
      console.log('Still missing content:');
      withoutContent.forEach(s => console.log(`  - ${s.slug}`));
    } else {
      console.log('All souls have content. Launch-blocker cleared.');
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
