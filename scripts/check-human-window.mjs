#!/usr/bin/env node
// scripts/check-human-window.mjs
// ----------------------------------------------------------------------------
// THE HIVE — HUMAN-WINDOW-001 commit 2. Two guards, one script, no dependencies:
//
//   RULE 1 (C7, Francis Sept 26 — closes checklist A · guard extension)
//     app/api/member/**  must import resolveMemberSession and declare the four
//                        route exports. A member route without a session check is
//                        an open door; without the exports it can serve a cached
//                        fetch (FIND-POLL-CACHE).
//     app/api/public/**  must NOT import any session module. A public route that
//                        can see a session is a public route that can be made to
//                        act as somebody.
//
//   RULE 2 (Nikita carry-forward (a), NIK-HUMAN-WINDOW-001a)
//     Repo-wide over app/, lib/, components/: a read of `messages` that returns
//     message CONTENT must filter .eq('moderation_status','approved').
//     Commit 1 fixed one instance of this (app/page.tsx); this rule is what stops
//     the class. It matters because messages.moderation_status has NO check
//     constraint (Francis, SQL, Sept 26: 0 rows) — the column is free-form, so a
//     new value can appear at any time and only an allow-list excludes it.
//
// Run: node scripts/check-human-window.mjs      (also wired into prebuild)
// Exit 0 = clean. Exit 1 = a violation, printed with its file and line.
//
// Every exemption PRINTS. An exemption that does not print is an exemption nobody
// audits — which is exactly how the /activate export hole survived its first
// review in this repo.
// ----------------------------------------------------------------------------
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const REQUIRED_EXPORTS = ['runtime', 'dynamic', 'fetchCache', 'revalidate'];
const SESSION_IMPORT = /from\s+['"][^'"]*(supabase\/server|antenna\/member)['"]/;

// RULE 2 exemptions, by exact path, each with the reason it is not a content read.
// Anything not listed here is judged by the automatic content test below.
const MESSAGES_EXEMPT = new Map([
  // Nothing today. Writes and non-content reads are recognised automatically and
  // printed as EXEMPT with their reason — see classify(). This map exists for the
  // case the automatic test cannot decide, and it is deliberately empty rather
  // than pre-filled: an exemption should cost a line in a diff and a review.
]);

function walk(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      out = out.concat(walk(full));
    } else out.push(full);
  }
  return out;
}

const rel = (f) => relative(ROOT, f).split(sep).join('/');
const isSource = (f) => /\.(ts|tsx)$/.test(f) && !/\.bak/.test(f);

// ── RULE 1 ──────────────────────────────────────────────────────────────────
const failures = [];
const notes = [];

function checkTree(sub, kind) {
  const files = walk(join(ROOT, ...sub)).filter((f) => /^route\.(ts|tsx)$/.test(f.split(sep).pop()));
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const r = rel(file);
    for (const name of REQUIRED_EXPORTS) {
      if (!new RegExp(`^export const ${name}\\s*=`, 'm').test(src)) {
        failures.push({ where: r, why: `does not export const ${name} — see FIND-POLL-CACHE` });
      }
    }
    if (kind === 'member') {
      const imports = /import[^;]*\bresolveMemberSession\b[^;]*from\s+['"][^'"]*antenna\/member['"]/s.test(src);
      const calls = /\bresolveMemberSession\s*\(/.test(src);
      if (!imports) failures.push({ where: r, why: 'does not import resolveMemberSession from lib/antenna/member' });
      else if (!calls) failures.push({ where: r, why: 'imports resolveMemberSession but never calls it' });
      else notes.push({ where: r, note: 'member session resolved server-side' });
    } else {
      if (SESSION_IMPORT.test(src) || /next\/headers/.test(src)) {
        failures.push({ where: r, why: 'imports a session module or next/headers — a public route must hold no session' });
      } else {
        notes.push({ where: r, note: 'no session module imported' });
      }
    }
  }
  return files.length;
}

const memberCount = checkTree(['app', 'api', 'member'], 'member');
const publicCount = checkTree(['app', 'api', 'public'], 'public');

// ── RULE 2 ──────────────────────────────────────────────────────────────────
/**
 * Blanks comments so the chain scanner cannot be fooled by punctuation inside them,
 * while preserving every byte offset and line break so reported line numbers stay
 * true. String literals are tracked, so a '//' inside a URL is not mistaken for a
 * comment — which matters because blanking to end-of-line there could erase a real
 * .eq() on the same line.
 *
 * Found by this guard's own negative control: app/api/bee/reply/route.ts:95-99 has
 * a comment between .from('messages') and .insert(, and a comma inside that comment
 * ended the chain early, so a plain insert was reported as undecidable.
 */
function blankComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (quote) {
      if (c === '\\') { out += c + (d ?? ''); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && d === '/') {
      while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
      continue;
    }
    if (c === '/' && d === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += src[i] === '\n' ? '\n' : ' '; i++; }
      out += '  '; i += 2; continue;
    }
    out += c; i++;
  }
  return out;
}

/**
 * Walks forward from a `.from('messages')` match and returns the chained
 * expression, stopping at the first `;` or `,` that is not inside brackets. That
 * handles both a plain statement and an element of a Promise.all([...]) array,
 * which is how app/page.tsx and app/mission-control/page.tsx write theirs.
 */
function chainFrom(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return src.slice(start, i);
      depth--;
    } else if ((c === ';' || c === ',') && depth === 0) return src.slice(start, i);
  }
  return src.slice(start);
}

const APPROVED = /\.eq\(\s*['"]moderation_status['"]\s*,\s*['"]approved['"]\s*\)/;
const SELECT = /\.select\(\s*(['"])([^'"]*)\1/;

/** ok | {exempt: reason} | {fail: reason} */
function classify(chain) {
  if (/\.insert\s*\(/.test(chain)) return { exempt: 'write, not a read' };
  if (/\.update\s*\(/.test(chain)) return { exempt: 'write, not a read' };
  if (/\.delete\s*\(/.test(chain)) return { exempt: 'write, not a read' };
  if (APPROVED.test(chain)) return { ok: true };

  // Not a content read: a count, or a projection that cannot return message text.
  // The filter exists to stop CONTENT reaching a surface; a heartbeat or a tally
  // that selects no content has nothing to leak. Stated as a rule rather than a
  // per-file exemption so it cannot rot, and printed so it is never silent.
  const m = SELECT.exec(chain);
  const fields = m ? m[2] : null;
  if (/count\s*:\s*['"]exact['"]/.test(chain)) return { exempt: 'count only, returns no content' };
  if (fields !== null && fields !== '*' && !/\bcontent\b/.test(fields)) {
    return { exempt: `selects ${JSON.stringify(fields)} — no content` };
  }
  if (fields === null) return { fail: 'could not determine the select list — add the filter or an exemption' };
  return { fail: 'returns message content without .eq(\'moderation_status\',\'approved\')' };
}

const trees = ['app', 'lib', 'components'];
const messageSites = [];
for (const t of trees) {
  for (const file of walk(join(ROOT, t)).filter(isSource)) {
    const src = blankComments(readFileSync(file, 'utf8'));
    const r = rel(file);
    const re = /\.from\(\s*['"]messages['"]\s*\)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const line = src.slice(0, m.index).split('\n').length;
      const chain = chainFrom(src, m.index);
      const verdict = MESSAGES_EXEMPT.has(r) ? { exempt: MESSAGES_EXEMPT.get(r) } : classify(chain);
      messageSites.push({ where: `${r}:${line}`, verdict });
      if (verdict.fail) failures.push({ where: `${r}:${line}`, why: verdict.fail });
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────
console.log(`RULE 1 — app/api/member/** (${memberCount} route file(s)) and app/api/public/** (${publicCount})`);
if (memberCount + publicCount === 0) console.log('  (no route files yet)');
for (const n of [...notes]) {
  const bad = failures.find((f) => f.where === n.where);
  if (!bad) console.log(`  ok      ${n.where}  —  ${n.note}`);
}
for (const f of failures.filter((f) => !f.where.includes(':'))) {
  console.log(`  FAIL    ${f.where}  —  ${f.why}`);
}

console.log(`\nRULE 2 — reads of messages across ${trees.join('/, ')}/ (${messageSites.length} site(s))`);
const width = Math.max(...messageSites.map((s) => s.where.length), 10);
for (const s of messageSites) {
  const label = s.verdict.fail ? 'FAIL' : s.verdict.exempt ? 'EXEMPT' : 'ok';
  const note = s.verdict.fail ? '  ' + s.verdict.fail : s.verdict.exempt ? '  ' + s.verdict.exempt : '';
  console.log(`  ${label.padEnd(6)}  ${s.where.padEnd(width)}${note}`);
}

if (failures.length > 0) {
  console.error(`\ncheck-human-window: ${failures.length} violation(s).`);
  process.exit(1);
}
const guarded = messageSites.filter((s) => !s.verdict.exempt).length;
const exemptCount = messageSites.length - guarded;
console.log(
  `\ncheck-human-window: rule 1 clean (${memberCount} member, ${publicCount} public); ` +
    `rule 2 clean (${guarded} content read(s) filtered, ${exemptCount} exempt and printed).`,
);
process.exit(0);
