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
for (const file of routeFiles) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);

  // The import must name the symbol, and it must come from the one auth module.
  const importsVerifier =
    new RegExp(`import[^;]*\\b${VERIFIER}\\b[^;]*from\\s+['"][^'"]*antenna/auth['"]`, 's').test(src);
  const callsVerifier = new RegExp(`\\b${VERIFIER}\\s*\\(`).test(src);

  if (!importsVerifier) failures.push({ rel, why: `does not import ${VERIFIER} from lib/antenna/auth` });
  else if (!callsVerifier) failures.push({ rel, why: `imports ${VERIFIER} but never calls it` });
}

const width = Math.max(...routeFiles.map((f) => relative(ROOT, f).length));
for (const file of routeFiles) {
  const rel = relative(ROOT, file);
  const bad = failures.find((f) => f.rel === rel);
  console.log(`  ${bad ? 'FAIL' : 'ok  '}  ${rel.padEnd(width)}${bad ? '  ' + bad.why : ''}`);
}

if (failures.length > 0) {
  console.error(
    `\ncheck-bee-routes: ${failures.length} of ${routeFiles.length} route file(s) bypass ${VERIFIER}.`,
  );
  console.error('Every /api/bee/* handler must authenticate through the one verifier (§6.6).');
  process.exit(1);
}

console.log(`\ncheck-bee-routes: all ${routeFiles.length} route file(s) go through ${VERIFIER}.`);
process.exit(0);
