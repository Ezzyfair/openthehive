#!/usr/bin/env node
// scripts/antenna-release.mjs
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — the installer release step (XI-1 v0.2.2 §2, §13 step 6).
//
// One command keeps four things in agreement:
//   1. antenna/templates/*.md          the authoritative documents
//   2. public/antenna/antenna.py       the same documents, embedded
//   3. public/antenna/antenna.py.sha256 the digest members check against
//   4. lib/antenna/version.ts          the version and digest the dashboard prints
//
// lib/antenna/version.ts is the single source for the VERSION. antenna.py's
// CLIENT_VERSION must equal it, and this script refuses to publish if it does not
// — a client that reports a version the colony never published makes the
// heartbeat's update notice lie.
//
//   node scripts/antenna-release.mjs           write everything, print the digest
//   node scripts/antenna-release.mjs --check   verify only; exit 1 on any drift
//
// --check is the one to run before merging: it fails if someone edited a template
// or the client without re-publishing, which is exactly how a member ends up
// checking a digest that no longer matches the file they downloaded.
// ----------------------------------------------------------------------------
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const CLIENT = join(ROOT, 'public/antenna/antenna.py');
const DIGEST = join(ROOT, 'public/antenna/antenna.py.sha256');
const VERSION_TS = join(ROOT, 'lib/antenna/version.ts');
const TEMPLATES = [
  { name: 'SKILL.md', constant: 'SKILL_MD', file: join(ROOT, 'antenna/templates/SKILL.md') },
  { name: 'SOUL-LAYER.md', constant: 'SOUL_LAYER_MD', file: join(ROOT, 'antenna/templates/SOUL-LAYER.md') },
];

const check = process.argv.includes('--check');
const problems = [];

// ── the version, from its single source ──────────────────────────────────────
const versionTs = readFileSync(VERSION_TS, 'utf8');
const versionMatch = /export const LATEST_CLIENT_VERSION = '([^']+)'/.exec(versionTs);
if (!versionMatch) {
  console.error('antenna-release: could not read LATEST_CLIENT_VERSION from lib/antenna/version.ts');
  process.exit(1);
}
const VERSION = versionMatch[1];

// ── embed the templates ──────────────────────────────────────────────────────
let client = readFileSync(CLIENT, 'utf8');
const before = client;

for (const t of TEMPLATES) {
  const body = readFileSync(t.file, 'utf8');
  if (body.includes('"""')) {
    console.error(`antenna-release: ${t.name} contains a Python triple quote and cannot be embedded verbatim`);
    process.exit(1);
  }
  if (body.includes('\\')) {
    console.error(`antenna-release: ${t.name} contains a backslash; the r""" block would keep it literal — remove it`);
    process.exit(1);
  }
  const begin = `# --- BEGIN EMBEDDED TEMPLATE: ${t.name} ---`;
  const end = `# --- END EMBEDDED TEMPLATE: ${t.name} ---`;
  const pattern = new RegExp(`${begin.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&')}[\\s\\S]*?${end.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&')}`);
  if (!pattern.test(client)) {
    console.error(`antenna-release: markers for ${t.name} not found in antenna.py`);
    process.exit(1);
  }
  client = client.replace(pattern, `${begin}\n${t.constant} = r"""${body}"""\n${end}`);
}

// ── the client must report the published version ─────────────────────────────
const clientVersion = /^CLIENT_VERSION = "([^"]+)"/m.exec(client);
if (!clientVersion) {
  console.error('antenna-release: could not read CLIENT_VERSION from antenna.py');
  process.exit(1);
}
if (clientVersion[1] !== VERSION) {
  problems.push(
    `antenna.py CLIENT_VERSION is ${clientVersion[1]} but lib/antenna/version.ts says ${VERSION}. ` +
      'version.ts is the single source — change antenna.py to match.',
  );
}

if (client !== before) {
  if (check) problems.push('embedded templates in antenna.py are out of date — run node scripts/antenna-release.mjs');
  else writeFileSync(CLIENT, client);
}

// ── digest ───────────────────────────────────────────────────────────────────
const sha = createHash('sha256').update(readFileSync(CLIENT)).digest('hex');
const digestLine = `${sha}  antenna.py\n`;

let existingDigest = '';
try {
  existingDigest = readFileSync(DIGEST, 'utf8');
} catch {
  existingDigest = '';
}
if (existingDigest !== digestLine) {
  if (check) problems.push(`public/antenna/antenna.py.sha256 is stale (file is ${sha})`);
  else writeFileSync(DIGEST, digestLine);
}

// ── the digest the dashboard prints ──────────────────────────────────────────
const shaMatch = /export const ANTENNA_SHA256: string \| null = ([^;]+);/.exec(versionTs);
if (!shaMatch) {
  console.error('antenna-release: could not find ANTENNA_SHA256 in lib/antenna/version.ts');
  process.exit(1);
}
const want = `'${sha}'`;
if (shaMatch[1].trim() !== want) {
  if (check) problems.push(`lib/antenna/version.ts ANTENNA_SHA256 is stale (should be ${sha})`);
  else writeFileSync(VERSION_TS, versionTs.replace(shaMatch[0], `export const ANTENNA_SHA256: string | null = ${want};`));
}

if (problems.length > 0) {
  console.error('\nantenna-release: out of sync\n');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`antenna-release: ${check ? 'in sync' : 'published'}`);
console.log(`  version  ${VERSION}`);
console.log(`  sha256   ${sha}`);
console.log(`  client   public/antenna/antenna.py  ->  /antenna/antenna.py`);
console.log(`  digest   public/antenna/antenna.py.sha256`);
process.exit(0);
