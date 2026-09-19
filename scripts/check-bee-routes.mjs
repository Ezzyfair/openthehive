#!/usr/bin/env node
// scripts/check-bee-routes.mjs
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — XI-1 v0.2.2 §6.6 / F8:
//   "a unit test walks app/api/bee/** and fails if any route file does not
//    import it [verifyBeeToken]. Revocation is therefore immediate everywhere."
//
// This repo has no test runner, so the check is a dependency-free script:
//   node scripts/check-bee-routes.mjs
// Exit 0 = every bee route goes through the one verifier. Exit 1 = one does not,
// which means there is a second way to authenticate a bee and revocation is no
// longer immediate everywhere.
//
// The check is deliberately blunt. It proves the import exists and the symbol is
// called somewhere in the file; it cannot prove it is the FIRST statement of the
// handler. That part is Nikita's adversarial read (§13 step 8).
// ----------------------------------------------------------------------------
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const BEE_DIR = join(ROOT, 'app', 'api', 'bee');
const VERIFIER = 'verifyBeeToken';

// The single exemption, by exact path. /activate is where a bee token comes
// FROM: the caller presents a one-time install token and leaves with a bee
// token, so there is nothing for the verifier to verify. Every other route on
// this namespace must go through it.
//
// Listed here rather than skipped silently: an exemption that does not print is
// an exemption nobody audits. Adding to this set is a design change and needs a
// Nikita ruling, not a commit.
const MINTS_TOKENS = new Set(['app/api/bee/activate/route.ts']);

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
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else out.push(full);
  }
  return out;
}

const routeFiles = walk(BEE_DIR).filter((f) => {
  const base = f.split(sep).pop();
  return /^route\.(ts|tsx|js|mjs)$/.test(base);
});

if (routeFiles.length === 0) {
  console.log('check-bee-routes: no route files under app/api/bee — nothing to check yet.');
  process.exit(0);
}

const failures = [];
const exempt = [];
for (const file of routeFiles) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file).split(sep).join('/');

  if (MINTS_TOKENS.has(rel)) {
    // Still checked, just for the opposite property: a minting route must not
    // quietly grow a second authentication path.
    if (new RegExp(`\\b${VERIFIER}\\s*\\(`).test(src)) {
      failures.push({ rel, why: `is exempt as a minting route but calls ${VERIFIER}` });
    } else {
      exempt.push(rel);
    }
    continue;
  }

  // Bees never hold member sessions (Francis's ruling, Sept 13). The bee lane is
  // the bee token and nothing else: a cookie session reaching /api/bee/* would be
  // a second way in, past the verifier and past revocation.
  if (/from\s+['"][^'"]*(supabase\/server|antenna\/member)['"]/.test(src) || /next\/headers/.test(src)) {
    failures.push({ rel, why: 'imports a member-session module or next/headers — bees never hold member sessions' });
    continue;
  }

  // The import must name the symbol, and it must come from the one auth module.
  const importsVerifier =
    new RegExp(`import[^;]*\\b${VERIFIER}\\b[^;]*from\\s+['"][^'"]*antenna/auth['"]`, 's').test(src);
  const callsVerifier = new RegExp(`\\b${VERIFIER}\\s*\\(`).test(src);

  if (!importsVerifier) failures.push({ rel, why: `does not import ${VERIFIER} from lib/antenna/auth` });
  else if (!callsVerifier) failures.push({ rel, why: `imports ${VERIFIER} but never calls it` });
}

const width = Math.max(...routeFiles.map((f) => relative(ROOT, f).length));
for (const file of routeFiles) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const bad = failures.find((f) => f.rel === rel);
  const isExempt = exempt.includes(rel);
  const label = bad ? 'FAIL' : isExempt ? 'EXEMPT' : 'ok';
  const note = bad ? '  ' + bad.why : isExempt ? '  mints the token — nothing to verify' : '';
  console.log(`  ${label.padEnd(6)}  ${rel.padEnd(width)}${note}`);
}

if (failures.length > 0) {
  console.error(
    `\ncheck-bee-routes: ${failures.length} of ${routeFiles.length} route file(s) bypass ${VERIFIER}.`,
  );
  console.error('Every /api/bee/* handler must authenticate through the one verifier (§6.6).');
  process.exit(1);
}

console.log(`\ncheck-bee-routes: ${routeFiles.length - exempt.length} of ${routeFiles.length} route file(s) go through ${VERIFIER}; ${exempt.length} exempt (mints tokens).`);
process.exit(0);
