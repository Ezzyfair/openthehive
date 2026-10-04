#!/usr/bin/env node
// ops/dreamers/facts.mjs
// ----------------------------------------------------------------------------
// THE HIVE — the optional, refreshable half of the Dreamers' true material.
// DREAMERS-008 B.
//
// facts.md is canon: a human writes it, install.sh copies it, and it is the half that
// must always be there. This file is the half that can go stale — the Skill Vault — so
// it is fetched on demand from the live site rather than transcribed into the repo,
// where it would be a second copy of the truth drifting away from the first.
//
//   node facts.mjs --refresh
//
// writes ~/.openclaw/dreamers/skills.md as "Skill Vault: <title>" lines. The loop reads
// that file if it exists and shrugs if it does not: a refresh that finds nothing, a page
// that changes its markup, a machine with no network — all of those cost the prompt its
// skill lines and nothing else, because facts.md still stands alone.
//
// WHAT THIS NEVER DOES: it writes no prompt and no model output, it reads no env var,
// and it posts nothing. The only thing it puts on disk is the title list below.
// ----------------------------------------------------------------------------
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const RUNTIME = join(homedir(), '.openclaw', 'dreamers');
const SKILLS_FILE = join(RUNTIME, 'skills.md');
const SKILLS_URL = 'https://www.openthehive.ai/skills';
const FETCH_TIMEOUT_MS = 20_000;

/**
 * MEASURED, not assumed (Oct 4): /skills server-renders every skill title as
 *
 *   <h4 class="text-[14px] font-bold text-hive-text mb-2">Structured Memory System</h4>
 *
 * 39 of them — the 33 Worker Bee skills plus AWAKEN's six — under the five section
 * headings BUILD, SHIP, PROTECT, COMMUNICATE and AWAKEN.
 *
 * The 14px class is load-bearing. The same page carries fifteen OTHER h4s at
 * `text-[15px] font-black` holding the soul archetypes (The Scholar, The Operator, …),
 * and a looser `<h4[^>]*>` would scoop those up and tell the Dreamers that "The Oracle"
 * is a skill. Keyed on the class, a markup change yields ZERO titles rather than wrong
 * ones — and zero titles is a case this file already handles by writing nothing.
 */
const RE_SKILL_H4 = /<h4[^>]*text-\[14px\][^>]*>([^<]+)<\/h4>/g;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The handful of entities a title could plausibly carry. Numeric forms included. */
function decode(s) {
  return String(s ?? '')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Pure: the skill titles in a /skills document, in page order, deduped. */
export function extractSkillTitles(html) {
  const out = [];
  const seen = new Set();
  RE_SKILL_H4.lastIndex = 0;
  for (let m = RE_SKILL_H4.exec(String(html ?? '')); m; m = RE_SKILL_H4.exec(String(html ?? ''))) {
    const title = decode(m[1]).replace(/\s+/g, ' ').trim();
    if (!title || seen.has(title)) continue;
    seen.add(title);
    out.push(title);
  }
  return out;
}

/** Pure: titles → the file body the loop reads. One fact per line, same as facts.md. */
export function renderSkillsFile(titles) {
  return (titles ?? []).map((t) => `Skill Vault: ${t}`).join('\n') + '\n';
}

/**
 * --refresh. Returns the number of titles written.
 *
 * NOTHING IS WRITTEN ON ZERO TITLES — not even an empty file. A truncating write would
 * replace a good list from yesterday with nothing the first time the page is slow or its
 * markup moves, so a failed refresh leaves the previous list exactly where it was and
 * says so on stdout.
 */
async function refresh() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  let html;
  try {
    const res = await fetch(SKILLS_URL, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) {
      process.stdout.write(`skills refresh: HTTP ${res.status} — nothing written\n`);
      return 0;
    }
    html = await res.text();
  } catch (e) {
    const why = e?.name === 'AbortError' ? 'timeout' : (e?.message ?? 'fetch failed');
    process.stdout.write(`skills refresh: ${why} — nothing written\n`);
    return 0;
  } finally {
    clearTimeout(timer);
  }

  const titles = extractSkillTitles(html);
  if (titles.length === 0) {
    process.stdout.write(
      'skills refresh: no skill titles found in the HTML — nothing written ' +
        '(facts.md still works alone)\n',
    );
    return 0;
  }

  await mkdir(RUNTIME, { recursive: true });
  await writeFile(SKILLS_FILE, renderSkillsFile(titles), { mode: 0o600 });
  process.stdout.write(`skills refresh: ${titles.length} titles -> ${SKILLS_FILE}\n`);
  return titles.length;
}

// DREAMERS-006 / FIND-LOOP-IMPORT, applied here from the start: argv is read and the
// network is touched ONLY when this file is the script Node was started with. A test or
// another module that imports it gets the two pure functions and nothing else.
const isEntryPoint = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (isEntryPoint) {
  const args = process.argv.slice(2);
  if (!args.includes('--refresh')) {
    process.stderr.write('usage: facts.mjs --refresh\n');
    process.exitCode = 2;
  } else {
    refresh().catch((e) => {
      process.stdout.write(`skills refresh: ${e?.message ?? e} — nothing written\n`);
      process.exitCode = 1;
    });
  }
}
