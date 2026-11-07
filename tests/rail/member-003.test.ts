// tests/rail/member-003.test.ts
// ----------------------------------------------------------------------------
// THE HIVE — MEMBER-003 item 6. Runs under the repo's one test command:
//   npm run test:rail
// It lives in tests/rail/ because that is the only test layout the repo has; it uses
// the same resolver and the same tsc → node --test pipeline, and touches no rail code.
//
// WHAT IS REAL AND WHAT IS STUBBED:
//   REAL    — lib/member-provision.ts (ensureScoutMember), lib/member-copy.ts
//             (beeStateSentence, ECON_FOR_MY_HUMAN), lib/email/welcome.ts
//             (sendWelcomeOnce), lib/chat-view.ts (relativeTime).
//   STUBBED — the database (members-only and email_sends-only fakes) and sendEmail.
//   SOURCE  — the register route's one-welcome / no-scout_welcome_v1 change and the
//             webhook route's try/catch around the welcome are checked in the source:
//             both are route wiring a unit test cannot drive (NextRequest, a Stripe
//             signature, env), so the structure is asserted directly.
// ----------------------------------------------------------------------------
import './resolver'; // MUST stay first: installs the '@/...' require hook.
import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureScoutMember } from '@/lib/member-provision';
import { beeStateSentence, ECON_FOR_MY_HUMAN } from '@/lib/member-copy';
import { relativeTime } from '@/lib/chat-view';
import { sendWelcomeOnce, WELCOME_TEMPLATE } from '@/lib/email/welcome';

const nodeFs: any = require('node:fs');
const nodePath: any = require('node:path');
const nodeCrypto: any = require('node:crypto');

/** The repo root, from <dist>/tests/rail/. Source files are read from there, not dist. */
const REPO_ROOT: string = nodePath.resolve(__dirname, '..', '..', '..');

// ── fakes ───────────────────────────────────────────────────────────────────

/** `members` only: the upsert(…, {ignoreDuplicates}).select('id') chain, email-unique. */
function fakeMembersDb(error: string | null = null) {
  const rows: any[] = [];
  return {
    rows,
    from(table: string) {
      assert.equal(table, 'members');
      let pending: any = null;
      let opts: any = null;
      const q: any = {
        upsert(obj: any, o: any) {
          pending = obj;
          opts = o;
          return q;
        },
        select(_cols: string) {
          if (error) return Promise.resolve({ data: null, error: { message: error } });
          const exists = rows.some((r) => r.email === pending.email);
          if (exists && opts?.ignoreDuplicates) return Promise.resolve({ data: [], error: null });
          const row = { id: 'm-' + (rows.length + 1), ...pending };
          rows.push(row);
          return Promise.resolve({ data: [{ id: row.id }], error: null });
        },
      };
      return q;
    },
  };
}

interface SendRow { to_email: string; template: string; status: string }
/** email_sends only: the select chain sendWelcomeOnce uses, and nothing else. */
function fakeEmailDb(rows: SendRow[] = []) {
  return {
    rows,
    from(table: string) {
      assert.equal(table, 'email_sends');
      const filters: Record<string, string> = {};
      const q: any = {
        select: () => q,
        eq: (col: string, val: string) => {
          filters[col] = val;
          return q;
        },
        limit: async () => ({
          data: rows.filter((r) => Object.keys(filters).every((k) => (r as any)[k] === filters[k])).map(() => ({ id: 'x' })),
          error: null,
        }),
      };
      return q;
    },
  };
}
function mockSend() {
  const calls: any[] = [];
  const fn: any = async (a: any) => {
    calls.push(a);
    a.supabase.rows.push({ to_email: a.to, template: a.template, status: 'sent' });
    return { sent: true };
  };
  return { fn, calls };
}

// ── item 1 · a members row at Scout creation, idempotent on email ────────────

test('MEMBER-003 · Scout creation creates exactly one members row, linked to the agent', async () => {
  const db = fakeMembersDb();
  const r = await ensureScoutMember(db, { email: 'Scout@Example.com', agentId: 'agent-1', referralCode: 'BEE-ABCD' });
  assert.deepEqual(r, { created: true });
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].email, 'scout@example.com', 'email lowercased, as members.email is stored');
  assert.equal(db.rows[0].agent_id, 'agent-1', 'linked to the agent');
  assert.equal(db.rows[0].tier, 'scout');
  assert.equal(db.rows[0].status, 'first_flight');
  assert.equal(db.rows[0].referral_code, 'BEE-ABCD');
  assert.equal('stripe_customer_id' in db.rows[0], false, 'no Stripe customer is written for a Scout');
});

test('MEMBER-003 · a second Scout creation for the same email creates none and keeps the first link', async () => {
  const db = fakeMembersDb();
  await ensureScoutMember(db, { email: 'dup@example.com', agentId: 'agent-1', referralCode: 'A' });
  const again = await ensureScoutMember(db, { email: 'DUP@example.com', agentId: 'agent-2', referralCode: 'B' });
  assert.deepEqual(again, { created: false }, 'idempotent on email');
  assert.equal(db.rows.length, 1, 'no second row');
  assert.equal(db.rows[0].agent_id, 'agent-1', 'the original agent link is not clobbered');
});

test('MEMBER-003 · a members upsert error is returned, not thrown (Scout creation survives it)', async () => {
  const db = fakeMembersDb('null value in column "stripe_customer_id" violates not-null constraint');
  const r = await ensureScoutMember(db, { email: 'x@example.com', agentId: 'a', referralCode: null });
  assert.equal(r.created, false);
  assert.ok('error' in r && typeof r.error === 'string' && r.error.length > 0);
});

// ── item 2 · one welcome, never scout_welcome_v1 ─────────────────────────────

test('MEMBER-003 · the Scout path sends exactly one welcome, the member welcome template', async () => {
  const db = fakeEmailDb();
  const send = mockSend();
  const r = await sendWelcomeOnce({ supabase: db, to: 'new@example.com', site: 'https://site.test', agentId: 'agent-1' }, send.fn);
  assert.deepEqual(r, { sent: true });
  assert.equal(send.calls.length, 1, 'exactly one welcome');
  assert.equal(send.calls[0].template, WELCOME_TEMPLATE);
  assert.notEqual(send.calls[0].template, 'scout_welcome_v1', 'never the deprecated template');
});

test('MEMBER-003 · the register route no longer sends scout_welcome_v1 (template retained, deprecated)', () => {
  const src: string = nodeFs.readFileSync(nodePath.join(REPO_ROOT, 'app/api/agents/register/route.ts'), 'utf8');
  // The live send path through lib/mail/sendEmail is gone...
  assert.doesNotMatch(src, /^import \{ sendEmail \}/m, 'the sendEmail import is removed');
  // ...and scout_welcome_v1 survives only inside the deprecation block (not deleted).
  assert.match(src, /DEPRECATED scout_welcome_v1 — retained unsent \(MEMBER-003 item 2\):/);
  const deprMarker = src.indexOf('DEPRECATED scout_welcome_v1');
  const templateUse = src.indexOf("template: 'scout_welcome_v1'");
  assert.ok(templateUse > deprMarker, 'scout_welcome_v1 appears only after the deprecation marker');
  // The one live welcome is sendWelcomeOnce.
  assert.match(src, /await sendWelcomeOnce\(\{ supabase, to: email/);
});

// ── item 3 · the bee's state, in words — the four sentences from fixture rows ─

test('MEMBER-003 · the bee card renders each of the four state sentences from fixture rows', () => {
  const now = Date.parse('2026-11-06T12:00:00Z');

  // 1 · Graduated — first_flight_completed_at set.
  assert.equal(
    beeStateSentence({ first_flight_completed_at: '2026-10-21T09:30:00Z' }, '2026-11-06T11:00:00Z', now),
    'Graduated Oct 21, 2026.',
  );

  // 2 · Waiting — no Antenna contact ever.
  assert.equal(
    beeStateSentence({ first_flight_completed_at: null, status: 'first_flight', first_flight_hours: 0 }, null, now),
    'Waiting for its First Flight.',
  );

  // 3 · Quiet — had contact, but longer ago than the quiet window.
  const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(
    beeStateSentence({ first_flight_completed_at: null, status: 'first_flight' }, threeDaysAgo, now),
    `Quiet since ${relativeTime(threeDaysAgo)}.`,
  );

  // 4 · In its First Flight — in contact now, hour from first_flight_hours.
  const tenMinAgo = new Date(now - 10 * 60 * 1000).toISOString();
  assert.equal(
    beeStateSentence({ first_flight_completed_at: null, status: 'first_flight', first_flight_hours: 7 }, tenMinAgo, now),
    'In its First Flight — hour 7.',
  );
});

// ── item 4 · ECON_FOR_MY_HUMAN equals §8 byte for byte ───────────────────────

test('MEMBER-003 · ECON_FOR_MY_HUMAN is §8 of the brief, byte for byte', () => {
  const fixturePath = nodePath.join(REPO_ROOT, 'tests/rail/fixtures/econ-for-my-human.txt');
  const fixture: string = nodeFs.readFileSync(fixturePath, 'utf8');
  assert.equal(ECON_FOR_MY_HUMAN, fixture, 'the constant matches the §8 fixture exactly');

  const sha = nodeCrypto.createHash('sha256').update(ECON_FOR_MY_HUMAN, 'utf8').digest('hex');
  assert.equal(sha, 'e1f4db6c144b1b312faa09c6f58bdbeb3978d2ed7fda31155d5d674df5d1f796', 'the §8 digest in lib/member-copy.ts is the one in force');
});

// ── item 5 · the webhook route returns the handler's response when the welcome throws ─

test('MEMBER-003 · the webhook route wraps the welcome in try/catch and returns after it', () => {
  const src: string = nodeFs.readFileSync(nodePath.join(REPO_ROOT, 'app/api/stripe/webhook/route.ts'), 'utf8');
  // The welcome call sits inside a try { … } catch { … } …
  assert.match(src, /try \{\s*await welcomeAfterCheckout\([^)]*\);\s*\} catch \(welcomeErr/);
  // …and the response is returned AFTER the catch, so a thrown welcome cannot change it.
  const catchEnd = src.indexOf('} catch (welcomeErr');
  const ret = src.indexOf('return NextResponse.json(result.body');
  assert.ok(catchEnd >= 0 && ret > catchEnd, 'the handler response is returned after the welcome try/catch');
});
