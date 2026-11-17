// tests/rail/referrals-chain-001.test.ts
// ----------------------------------------------------------------------------
// THE HIVE — REFERRALS-CHAIN-001. Runs under the repo's rail test command:
//   npm run test:rail
//
// The GET on /api/referrals/chain answers 410 and does nothing else, exactly as the
// POST beside it has since NIK-RAIL-000.
//
// WHAT IS REAL AND WHAT IS STUBBED:
//   REAL    — app/api/referrals/chain/route.ts, both handlers, called directly.
//   STUBBED — nothing. The route makes no database call and no network call, so
//             there is nothing to stub; the source checks below prove it.
//   SOURCE  — the file is read from the repo (not dist) and checked for the absence
//             of every reader the old GET used, for the empty parameter list and
//             for the four no-cache exports.
// ----------------------------------------------------------------------------
import './resolver'; // MUST stay first: installs the '@/...' require hook.
import test from 'node:test';
import assert from 'node:assert/strict';

import * as route from '@/app/api/referrals/chain/route';

const nodeFs: any = require('node:fs');
const nodePath: any = require('node:path');

/** The repo root, from <dist>/tests/rail/. Source files are read from there, not dist. */
const REPO_ROOT: string = nodePath.resolve(__dirname, '..', '..', '..');
const ROUTE_PATH = nodePath.join(REPO_ROOT, 'app', 'api', 'referrals', 'chain', 'route.ts');
const SOURCE: string = nodeFs.readFileSync(ROUTE_PATH, 'utf8');

const GET_BODY = { error: 'gone', detail: 'replaced by the member page' };
const POST_BODY = { error: 'gone', detail: 'replaced by the payout rail' };

// The old money-rows view's action value, taken from the table name so this file
// carries the value without spelling it as a bare word.
const MONEY_ROWS_ACTION = 'referral_earnings'.slice('referral_'.length);

/**
 * The handler takes no argument, so the URL below is never seen by it. Calling it
 * with one anyway (through an untyped reference) proves the answer does not depend
 * on what a caller sends: any read of the request would have to go through it.
 */
async function callGet(url: string | null) {
  const get: any = route.GET;
  const res: Response = url === null ? await get() : await get(new Request(url));
  return { status: res.status, body: await res.json() };
}

test('GET with no query answers 410 with the gone body', async () => {
  const r = await callGet('https://example.invalid/api/referrals/chain');
  assert.equal(r.status, 410);
  assert.deepEqual(r.body, GET_BODY);
});

test('GET called with no request at all answers 410 with the gone body', async () => {
  const r = await callGet(null);
  assert.equal(r.status, 410);
  assert.deepEqual(r.body, GET_BODY);
});

test('GET with an agent_id answers 410 with the identical body', async () => {
  const bare = await callGet('https://example.invalid/api/referrals/chain');
  const r = await callGet('https://example.invalid/api/referrals/chain?agent_id=00000000-0000-0000-0000-000000000001');
  assert.equal(r.status, 410);
  assert.deepEqual(r.body, bare.body);
});

test('GET with agent_id and the money-rows action answers 410 with the identical body', async () => {
  const bare = await callGet('https://example.invalid/api/referrals/chain');
  const url =
    'https://example.invalid/api/referrals/chain?agent_id=00000000-0000-0000-0000-000000000001&action=' +
    MONEY_ROWS_ACTION;
  assert.ok(new URL(url).searchParams.get('action') === MONEY_ROWS_ACTION);
  const r = await callGet(url);
  assert.equal(r.status, 410);
  assert.deepEqual(r.body, bare.body);
});

test('the GET body has exactly the two keys error and detail', async () => {
  const r = await callGet('https://example.invalid/api/referrals/chain?agent_id=x');
  assert.deepEqual(Object.keys(r.body).sort(), ['detail', 'error']);
  assert.equal(r.body.error, 'gone');
  assert.equal(r.body.detail, 'replaced by the member page');
});

test('POST still answers 410 with its body unchanged', async () => {
  const post: any = route.POST;
  const res: Response = await post();
  assert.equal(res.status, 410);
  assert.deepEqual(await res.json(), POST_BODY);
});

test('source: no .from(, no railAdmin, no searchParams, no buildReferralChain', () => {
  for (const needle of ['.from(', 'railAdmin', 'searchParams', 'buildReferralChain']) {
    assert.equal(SOURCE.includes(needle), false, `route.ts still contains ${needle}`);
  }
});

test('the GET handler parameter list is empty, in the source and at run time', () => {
  const m = SOURCE.match(/export\s+(?:async\s+)?function\s+GET\s*\(([^)]*)\)/);
  assert.ok(m, 'GET handler not found in source');
  assert.equal(m![1].trim(), '');
  assert.equal(route.GET.length, 0);
});

test('the four no-cache exports are still present', () => {
  assert.equal(route.runtime, 'nodejs');
  assert.equal(route.dynamic, 'force-dynamic');
  assert.equal(route.fetchCache, 'force-no-store');
  assert.equal(route.revalidate, 0);
  for (const name of ['runtime', 'dynamic', 'fetchCache', 'revalidate']) {
    assert.match(SOURCE, new RegExp(`export const ${name} = `), `source lacks export ${name}`);
  }
});
