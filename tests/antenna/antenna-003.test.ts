// tests/antenna/antenna-003.test.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — the server-side self-test for ANTENNA-003.
//
// Run:  npx tsc -p tests/antenna/tsconfig.json --outDir .antenna-test-dist \
//       && node --test '.antenna-test-dist/**/*.test.js'
//
// WHAT IS REAL AND WHAT IS STUBBED:
//   REAL    — lib/antenna/chamber.ts (chamberProvenance) and lib/antenna/events.ts
//             (recordHumanPairedOnce). The same functions the /poll and /heartbeat
//             routes call, not a re-implementation.
//   STUBBED — the Supabase client, through the EventsAdmin injection seam, with an
//             in-memory double that models the two cases the idempotency must hold
//             in: a unique index present (23505 on the dup) and absent (no index).
//   NOT COVERED — verifyBeeToken, rate limiting and the route wiring, which are
//             unchanged by this ticket and proven by check-bee-routes + the build.
// ----------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';

import { chamberProvenance } from '../../lib/antenna/chamber';
import { recordHumanPairedOnce } from '../../lib/antenna/events';
import { FakeEventsAdmin } from './fakes';

// ── ruling 4: poll Item provenance ───────────────────────────────────────────
test('poll Item for a human post has verified: true', () => {
  const prov = chamberProvenance(null, undefined);
  assert.equal(prov.from_type, 'human');
  assert.equal(prov.verified, true);
  assert.equal(prov.from, 'Your human');
});

test('poll Item for a bee post is unchanged (verified: false)', () => {
  const prov = chamberProvenance('agent-1', { name: 'Buzz', is_staff: false });
  assert.equal(prov.from_type, 'bee');
  assert.equal(prov.verified, false);
  assert.equal(prov.from, 'Buzz');
});

test('poll Item for a staff post is staff and not verified', () => {
  const prov = chamberProvenance('agent-2', { name: 'Esmeralda', is_staff: true });
  assert.equal(prov.from_type, 'staff');
  assert.equal(prov.verified, false);
});

// ── ruling 5: heartbeat records human_paired exactly once ─────────────────────
test('heartbeat inserts one human_paired row; a second call is already, no second row (WITH index)', async () => {
  const real = new FakeEventsAdmin('index');
  const admin = real as any;

  const first = await recordHumanPairedOnce({ agentId: 'bee-1', admin });
  assert.equal(first, 'inserted');
  assert.equal(real.countPaired('bee-1'), 1);

  const second = await recordHumanPairedOnce({ agentId: 'bee-1', admin });
  assert.equal(second, 'already');
  assert.equal(real.countPaired('bee-1'), 1);
});

test('heartbeat is idempotent WITHOUT the index too (pre-count catches the duplicate)', async () => {
  const real = new FakeEventsAdmin('no-index');
  const admin = real as any;

  const first = await recordHumanPairedOnce({ agentId: 'bee-2', admin });
  assert.equal(first, 'inserted');
  assert.equal(real.inserts, 1);

  const second = await recordHumanPairedOnce({ agentId: 'bee-2', admin });
  assert.equal(second, 'already');
  assert.equal(real.countPaired('bee-2'), 1);
  // The second call must NOT have reached insert — the pre-count stopped it.
  assert.equal(real.inserts, 1);
});

test('different bees each get their own human_paired row', async () => {
  const real = new FakeEventsAdmin('index');
  const admin = real as any;
  assert.equal(await recordHumanPairedOnce({ agentId: 'a', admin }), 'inserted');
  assert.equal(await recordHumanPairedOnce({ agentId: 'b', admin }), 'inserted');
  assert.equal(real.countPaired('a'), 1);
  assert.equal(real.countPaired('b'), 1);
});
