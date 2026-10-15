#!/usr/bin/env node
// scripts/check-rail-routes.mjs
// ----------------------------------------------------------------------------
// THE HIVE · payout rail — the money-path guard. RAIL-DESIGN-v1.1 §11, R18, R60.
// Ticket NIK-RAIL-003.
//
// Three rules, all dependency-free, chained into prebuild after check-bee-routes:
//
//   RULE A (§11)  every route under app/api/stripe/**, app/api/payouts/**,
//                 app/api/referrals/** and app/api/member/payouts/** exports
//                 runtime, dynamic, fetchCache and revalidate. A money route
//                 serving a memoized balance read is FIND-POLL-CACHE with money
//                 attached.
//   RULE B (§11)  no bare Supabase or Stripe constructor in those trees, nor in
//                 lib/rail/ callers. The factories in lib/rail/ are the only
//                 places either client is built, which is what makes R18 — one
//                 pinned API version — a fact rather than a habit.
//   RULE C (R60)  "Outside the three functions, no code under app/ or lib/ writes
//                 to referral_earnings, hive_revenue or payouts; guard-enforced."
//                 A .from('<money table>') chain carrying insert/update/upsert/
//                 delete fails, anywhere under app/ or lib/, except lib/rail/**.
//                 Reads are allowed; writes go through rail_accrue,
//                 rail_open_payout and rail_close_payout.
//
// Run: node scripts/check-rail-routes.mjs
// Exit 0 = clean. Exit 1 = a violation, printed with its file and line.
//
// EVERY FILE CHECKED AND EVERY EXEMPTION PRINTS. An exemption that does not print
// is an exemption nobody audits — the same rule check-human-window.mjs states.
// ----------------------------------------------------------------------------
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

// ── the trees RULE A and RULE B cover ───────────────────────────────────────
const MONEY_TREES = [
  ['app', 'api', 'stripe'],
  ['app', 'api', 'payouts'],
  ['app', 'api', 'referrals'],
  ['app', 'api', 'member', 'payouts'],
];
const REQUIRED_EXPORTS = ['runtime', 'dynamic', 'fetchCache', 'revalidate'];

// The member rule for member/payouts, per §11: "member rule for member/payouts".
const MEMBER_TREE = 'app/api/member/payouts';

// ── RULE C · the money tables and the one printed exemption ─────────────────
const MONEY_TABLES = ['referral_earnings', 'hive_revenue', 'payouts'];
const WRITE_VERBS = ['insert', 'update', 'upsert', 'delete'];

// R60's single exemption, by exact path, with the reason it is temporary.
const WRITE_EXEMPT = new Map([
  ['lib/referral-engine.ts', 'legacy writer, removed by NIK-RAIL-004'],
]);

// lib/rail/** is where the three functions are called from, so it is not a
// violation for rail code to name a money table.
const RAIL_LIB_PREFIX = 'lib/rail/';

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
const isRoute = (f) => /^route\.(ts|tsx)$/.test(f.split(sep).pop());

/**
 * Blanks comments while preserving every byte offset and line break, so a line
 * number stays true and prose about a rule cannot satisfy or break it. String
 * literals are tracked so a '//' inside a URL is not read as a comment. Copied in
 * construction from check-human-window.mjs, which found this the hard way: a
 * header comment describing a rule failed that rule.
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

/** The chained expression after a match, to the first `;` or `,` outside brackets. */
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

const failures = [];
const checked = [];
const exemptions = [];

// ── RULE A + RULE B over the money trees ────────────────────────────────────
let routeCount = 0;
for (const tree of MONEY_TREES) {
  const dir = join(ROOT, ...tree);
  const files = walk(dir).filter(isSource);
  const treeRel = tree.join('/');
  if (files.length === 0) {
    checked.push({ where: treeRel, note: 'tree does not exist yet — nothing to check' });
    continue;
  }
  for (const file of files) {
    const r = rel(file);
    const src = blankComments(readFileSync(file, 'utf8'));

    if (isRoute(file)) {
      routeCount++;
      const missing = REQUIRED_EXPORTS.filter(
        (name) => !new RegExp(`^export const ${name}\\s*=`, 'm').test(src),
      );
      if (missing.length) {
        for (const name of missing) {
          failures.push({ where: r, why: `does not export const ${name} — §11 no-cache posture` });
        }
      }
      // §11's member rule: a route under member/payouts resolves a member session.
      if (r.startsWith(MEMBER_TREE)) {
        const imports = /import[^;]*\bresolveMemberSession\b[^;]*from\s+['"][^'"]*antenna\/member['"]/s.test(src);
        const calls = /\bresolveMemberSession\s*\(/.test(src);
        if (!imports) failures.push({ where: r, why: 'member/payouts route does not import resolveMemberSession' });
        else if (!calls) failures.push({ where: r, why: 'imports resolveMemberSession but never calls it' });
      }
      checked.push({
        where: r,
        note: missing.length ? 'route' : `route · four exports declared${r.startsWith(MEMBER_TREE) ? ' · member session resolved' : ''}`,
      });
    } else {
      checked.push({ where: r, note: 'helper' });
    }

    // RULE B · no bare constructor anywhere in these trees, route or helper.
    let m;
    const reSupabase = /\bcreateClient\s*\(/g;
    while ((m = reSupabase.exec(src)) !== null) {
      const line = src.slice(0, m.index).split('\n').length;
      failures.push({ where: `${r}:${line}`, why: 'builds a Supabase client directly — use railAdmin() from lib/rail/db' });
    }
    const reStripe = /\bnew\s+Stripe\s*\(/g;
    while ((m = reStripe.exec(src)) !== null) {
      const line = src.slice(0, m.index).split('\n').length;
      failures.push({ where: `${r}:${line}`, why: 'builds a Stripe client directly — use railStripe() from lib/rail/stripe (R18)' });
    }
  }
}

// ── RULE C · R60, repo-wide over app/ and lib/ ──────────────────────────────
const writeSites = [];
for (const tree of ['app', 'lib']) {
  for (const file of walk(join(ROOT, tree)).filter(isSource)) {
    const r = rel(file);
    const src = blankComments(readFileSync(file, 'utf8'));
    for (const table of MONEY_TABLES) {
      const re = new RegExp(`\\.from\\(\\s*['"]${table}['"]\\s*\\)`, 'g');
      let m;
      while ((m = re.exec(src)) !== null) {
        const line = src.slice(0, m.index).split('\n').length;
        const chain = chainFrom(src, m.index);
        const verb = WRITE_VERBS.find((v) => new RegExp(`\\.${v}\\s*\\(`).test(chain));
        if (!verb) continue; // a read; allowed
        if (r.startsWith(RAIL_LIB_PREFIX)) {
          exemptions.push({ where: `${r}:${line}`, why: `lib/rail/ calls the three functions — .${verb}( on ${table} allowed here` });
          continue;
        }
        if (WRITE_EXEMPT.has(r)) {
          exemptions.push({ where: `${r}:${line}`, why: `${WRITE_EXEMPT.get(r)} — .${verb}( on ${table}` });
          continue;
        }
        writeSites.push({ where: `${r}:${line}`, table, verb });
        failures.push({
          where: `${r}:${line}`,
          why: `writes ${table} with .${verb}( outside the three functions — R60`,
        });
      }
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────
console.log(`RULE A/B — money trees: ${MONEY_TREES.map((t) => t.join('/')).join(', ')}`);
const width = Math.max(...checked.map((c) => c.where.length), 10);
for (const c of checked) {
  const bad = failures.find((f) => f.where === c.where || f.where.startsWith(c.where + ':'));
  console.log(`  ${(bad ? 'FAIL' : 'ok').padEnd(6)}  ${c.where.padEnd(width)}  ${c.note}`);
}
for (const f of failures.filter((f) => f.where.includes(':'))) {
  console.log(`  FAIL    ${f.where}  —  ${f.why}`);
}
for (const f of failures.filter((f) => !f.where.includes(':'))) {
  console.log(`  FAIL    ${f.where}  —  ${f.why}`);
}

console.log(`\nRULE C — R60: writes to ${MONEY_TABLES.join(', ')} across app/, lib/`);
if (exemptions.length === 0 && writeSites.length === 0) {
  console.log('  (no write site found outside the three functions)');
}
for (const e of exemptions) {
  console.log(`  EXEMPT  ${e.where}  —  ${e.why}`);
}
for (const w of writeSites) {
  console.log(`  FAIL    ${w.where}  —  writes ${w.table} with .${w.verb}(`);
}

if (failures.length > 0) {
  console.error(`\ncheck-rail-routes: ${failures.length} violation(s).`);
  process.exit(1);
}
console.log(
  `\ncheck-rail-routes: rule A clean (${routeCount} money route(s), four exports each); ` +
    `rule B clean (no direct Supabase or Stripe constructor); ` +
    `rule C clean (R60: ${exemptions.length} exemption(s), printed above).`,
);
process.exit(0);
