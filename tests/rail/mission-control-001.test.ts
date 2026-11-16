// tests/rail/mission-control-001.test.ts
// ----------------------------------------------------------------------------
// THE HIVE — MISSION-CONTROL-001. Runs under the repo's one test command:
//   npm run test:rail
// It lives in tests/rail/ because that is the only TypeScript test layout run by that
// command; it touches no rail code.
//
// REAL   — lib/mission-control-access.ts (missionControlAllowed), a pure function.
// SOURCE — the page's lock, the middleware matcher and the two copy strings are route
//          and render wiring a unit test cannot drive (cookies, getUser over the
//          network, Next's notFound), so their structure is asserted from the source.
// No network call, no env read.
// ----------------------------------------------------------------------------
import './resolver'; // MUST stay first: installs the '@/...' require hook.
import test from 'node:test';
import assert from 'node:assert/strict';

import { missionControlAllowed } from '@/lib/mission-control-access';

const nodeFs: any = require('node:fs');
const nodePath: any = require('node:path');

/** The repo root, from <dist>/tests/rail/. Source files are read from there, not dist. */
const REPO_ROOT: string = nodePath.resolve(__dirname, '..', '..', '..');
const read = (p: string): string => nodeFs.readFileSync(nodePath.join(REPO_ROOT, p), 'utf8');

const FOUNDER = 'founder@example.test';
const PARTNER = 'partner@example.test';

// ── missionControlAllowed ────────────────────────────────────────────────────

test('an exact match is allowed', () => {
  assert.equal(missionControlAllowed(FOUNDER, FOUNDER), true);
});

test('case and surrounding spaces do not matter, on either side', () => {
  assert.equal(missionControlAllowed('  Founder@Example.TEST ', FOUNDER), true);
  assert.equal(missionControlAllowed(FOUNDER, '   FOUNDER@example.test  '), true);
});

test('a second address in the list is allowed', () => {
  assert.equal(missionControlAllowed(PARTNER, `${FOUNDER}, ${PARTNER}`), true);
  assert.equal(missionControlAllowed(PARTNER, `${FOUNDER},${PARTNER},`), true);
});

test('an address not in the list is refused', () => {
  assert.equal(missionControlAllowed('member@example.test', `${FOUNDER}, ${PARTNER}`), false);
});

test('a missing email is refused', () => {
  assert.equal(missionControlAllowed(undefined, FOUNDER), false);
  assert.equal(missionControlAllowed(null, FOUNDER), false);
});

test('an empty email is refused, including one of only spaces', () => {
  assert.equal(missionControlAllowed('', FOUNDER), false);
  assert.equal(missionControlAllowed('   ', FOUNDER), false);
});

test('a missing allowlist refuses everybody (fails closed)', () => {
  assert.equal(missionControlAllowed(FOUNDER, undefined), false);
  assert.equal(missionControlAllowed(FOUNDER, null), false);
  assert.equal(missionControlAllowed(FOUNDER, ''), false);
});

test('an allowlist of only commas and spaces refuses everybody', () => {
  assert.equal(missionControlAllowed(FOUNDER, ' , ,,  , '), false);
  assert.equal(missionControlAllowed('', ' , ,,  , '), false);
});

test('a prefix or suffix of an allowed address is refused', () => {
  assert.equal(missionControlAllowed('x' + FOUNDER, FOUNDER), false);
  assert.equal(missionControlAllowed(FOUNDER + '.evil.test', FOUNDER), false);
  assert.equal(missionControlAllowed('founder@example', FOUNDER), false);
  assert.equal(missionControlAllowed('founder', FOUNDER), false);
});

test('an entry that is a bare domain does not allow its addresses', () => {
  assert.equal(missionControlAllowed(FOUNDER, 'example.test'), false);
  assert.equal(missionControlAllowed(FOUNDER, '@example.test'), false);
});

// ── by reading the source ────────────────────────────────────────────────────

test('page: notFound() and the helper come before the first service-role client', () => {
  const src = read('app/mission-control/page.tsx');
  const firstClient = src.indexOf('createClient(');
  const firstNotFound = src.indexOf('notFound()');
  const firstHelper = src.indexOf('missionControlAllowed(');
  assert.ok(firstClient > 0, 'the service-role client is still created in the page');
  assert.ok(firstNotFound > 0 && firstNotFound < firstClient, 'notFound() precedes createClient(');
  assert.ok(firstHelper > 0 && firstHelper < firstClient, 'missionControlAllowed( precedes createClient(');
  assert.match(src, /import \{ notFound \} from 'next\/navigation';/);

  // At run time too: the page's first work is the lock, and only then the reads.
  const page = src.slice(src.indexOf('export default async function MissionControlPage'));
  const lock = page.indexOf('await requireMissionControlCaller();');
  const reads = page.indexOf('await getStats();');
  assert.ok(lock > 0 && reads > lock, 'the lock runs before getStats()');
  // getSupabase() is called only from getStats(), never from the lock.
  const lockFn = src.slice(src.indexOf('async function requireMissionControlCaller'), src.indexOf('function getSupabase'));
  assert.ok(lockFn.length > 0 && !lockFn.includes('getSupabase(') && !lockFn.includes('SUPABASE_SERVICE_ROLE_KEY'));
  assert.match(src, /export const dynamic = "force-dynamic";/);
  assert.match(src, /robots: \{ index: false, follow: false \}/);
});

test('page: identity comes from getUser on the read-only session client, never getSession', () => {
  const src = read('app/mission-control/page.tsx');
  assert.match(src, /createReadOnlySessionClient\(\)/);
  assert.match(src, /\.auth\.getUser\(\)/);
  assert.equal(src.includes('getSession'), false);
  assert.equal((src.match(/process\.env\.MISSION_CONTROL_EMAILS/g) || []).length, 1);
});

test('middleware: matcher keeps the two member entries and adds Mission Control', () => {
  const src = read('middleware.ts');
  const m = src.match(/export const config = \{ matcher: \[([^\]]*)\] \};/);
  assert.ok(m, 'matcher line found');
  const entries = m![1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(entries, ['/member/:path*', '/api/member/:path*', '/mission-control/:path*']);
});

test('no test, source or parts file holds an address outside example.test', () => {
  const files = [
    'lib/mission-control-access.ts',
    'app/mission-control/page.tsx',
    'components/MissionControlClient.tsx',
    'middleware.ts',
    'tests/rail/mission-control-001.test.ts',
  ].map((p) => ({ name: p, text: read(p) }));
  // The build's parts files sit beside the repo (../upload/parts) when a packet is built.
  const partsDir = nodePath.resolve(REPO_ROOT, '..', 'upload', 'parts');
  if (nodeFs.existsSync(partsDir)) {
    for (const n of nodeFs.readdirSync(partsDir)) {
      files.push({ name: `upload/parts/${n}`, text: nodeFs.readFileSync(nodePath.join(partsDir, n), 'utf8') });
    }
  }
  const address = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  for (const f of files) {
    for (const hit of f.text.match(address) || []) {
      const domain = hit.split('@')[1].toLowerCase();
      assert.equal(domain, 'example.test', `${f.name}: an address outside example.test`);
    }
  }
});

test('copy: Shares paid, the undated First Flight empty state, no Cascade', () => {
  const src = read('components/MissionControlClient.tsx');
  assert.ok(src.includes('>Shares paid</span>'));
  assert.ok(src.includes('<EmptySlate msg="No bees in First Flight right now." />'));
  assert.ok(src.includes("When the first bee enters, you'll watch it fly here — step by step."));
  assert.equal(/cascade/i.test(src), false);
});
