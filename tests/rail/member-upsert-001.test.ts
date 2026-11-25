// tests/rail/member-upsert-001.test.ts
// ----------------------------------------------------------------------------
// THE HIVE — MEMBER-UPSERT-001. Runs under the repo's rail test command:
//   npm run test:rail
//
// A second checkout by a paying member changes only the tier, upward; anything
// else is held for a human; and an earlier subscription left running is recorded
// and alerted at once.
//
// WHAT IS REAL AND WHAT IS STUBBED:
//   REAL    — lib/rail/webhook-handler.ts handleStripeEvent, claimEvent,
//             alertRecipients; lib/tier.ts; lib/rail/catalog.ts; lib/mail/sendEmail.ts
//             (with no mail env it writes an email_sends row with status
//             skipped_no_env and sends nothing, which is how a test sees an alert).
//   STUBBED — HandlerDeps (FakeDb, FakeStripe, a clock), as
//             tests/rail/stripe-checkout-002.test.ts does it.
//
// TIERS COME FROM THE CODE. No tier word and no price is written in this file: the
// colony's tiers are read from TIER_ORDER, Stripe's word for each from
// STRIPE_TIER_TO_CANONICAL, and each one's mode and amount from MEMBERSHIP_PRICES.
//
// No network, no database, no Stripe.
// ----------------------------------------------------------------------------
import './resolver'; // MUST stay first: installs the '@/...' require hook.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  handleStripeEvent,
  claimEvent,
  alertRecipients,
  OLD_SUBSCRIPTION_OPEN_REASON,
  type HandlerResult,
} from '../../lib/rail/webhook-handler';
import type { AccrualDb } from '../../lib/rail/accrual';
import {
  TIER_ORDER,
  tierRank,
  isCanonicalTier,
  STRIPE_TIER_TO_CANONICAL,
  type CanonicalTier,
} from '../../lib/tier';
import { MEMBERSHIP_PRICES, type StripeMode } from '../../lib/rail/catalog';
import { welcomeAfterCheckout } from '../../lib/email/welcome';
import { FakeDb, FakeStripe, fakeEvent, sessionLine } from './fakes';

const nodeFs: any = require('node:fs');
const nodePath: any = require('node:path');
const mailModule: any = require('@/lib/mail/sendEmail');

const REPO_ROOT: string = nodePath.resolve(__dirname, '..', '..', '..');
const HANDLER_SRC: string = nodeFs.readFileSync(
  nodePath.join(REPO_ROOT, 'lib', 'rail', 'webhook-handler.ts'), 'utf8');
const THIS_SRC: string = nodeFs.readFileSync(
  nodePath.join(REPO_ROOT, 'tests', 'rail', 'member-upsert-001.test.ts'), 'utf8');

// ── environment: fake price ids by NAME, no mail env, no alert address ─────
MEMBERSHIP_PRICES.forEach((p, i) => { process.env[p.priceIdEnvVar] = 'price_fake_mu001_' + i; });
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_FROM_EMAIL;
delete process.env.HIVE_ALERT_EMAIL;

const ALERT_ONE = 'alert-one@example.test';
const ALERT_TWO = 'alert-two@example.test';

/** Sets HIVE_ALERT_EMAIL for one call and deletes it afterwards. */
async function withAlerts<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (value === undefined) delete process.env.HIVE_ALERT_EMAIL;
  else process.env.HIVE_ALERT_EMAIL = value;
  try {
    return await fn();
  } finally {
    delete process.env.HIVE_ALERT_EMAIL;
  }
}

// ── tiers, from the code ────────────────────────────────────────────────────
const STRIPE_WORDS = Object.keys(STRIPE_TIER_TO_CANONICAL);
const PAID: CanonicalTier[] = TIER_ORDER.filter((t) =>
  Object.values(STRIPE_TIER_TO_CANONICAL).includes(t));
const LOWEST: CanonicalTier = TIER_ORDER[0];

function stripeWordFor(c: CanonicalTier): string {
  const w = STRIPE_WORDS.find((k) => STRIPE_TIER_TO_CANONICAL[k] === c);
  assert.ok(w, 'every paid tier has a Stripe word');
  return w!;
}
function priceFor(c: CanonicalTier) {
  const i = MEMBERSHIP_PRICES.findIndex((p) => p.tier === stripeWordFor(c));
  assert.ok(i >= 0, 'every paid tier is in the catalog');
  return { ...MEMBERSHIP_PRICES[i], priceId: 'price_fake_mu001_' + i };
}
function modeFor(c: CanonicalTier): StripeMode {
  return priceFor(c).mode;
}

/** Every (lower, higher) pair of paid tiers, and every (held, bought) pair that is not up. */
const UP_PAIRS: Array<[CanonicalTier, CanonicalTier]> = [];
const NOT_UP_PAIRS: Array<[CanonicalTier, CanonicalTier]> = [];
for (const held of PAID) {
  for (const bought of PAID) {
    if (tierRank(bought) > tierRank(held)) UP_PAIRS.push([held, bought]);
    else NOT_UP_PAIRS.push([held, bought]);
  }
}

// ── the colony under test ───────────────────────────────────────────────────
const EMAIL = 'mu-payer@example.test';
const COACH = { id: 'ag_atlas', name: 'ATLAS', referral_code: 'ATLAS', status: 'active' };

const SEEDED_KEEP = {
  tokens_remaining: 4242,
  tokens_reset_at: '2026-12-01T00:00:00.000Z',
  referral_code: 'KEEP-THIS-CODE',
  subscription_started_at: '2026-10-01T00:00:00.000Z',
  wallet_expires_at: '2027-01-01T00:00:00.000Z',
};

function bee(tier: CanonicalTier | null, status = 'active', over: Record<string, unknown> = {}) {
  return {
    id: 'ag_mu', name: 'Mu Bee', email: EMAIL, soul: 'The Operator',
    referral_code: 'MUBEE', referred_by_code: null, status, tier, ...over,
  };
}

/** A paying member: a customer id, a running subscription, and the columns that must not move. */
function payingMember(tier: CanonicalTier | null, over: Record<string, unknown> = {}) {
  return {
    id: 'mem_mu', email: EMAIL, agent_id: 'ag_mu',
    stripe_customer_id: 'cus_old', stripe_subscription_id: 'sub_old',
    tier, status: 'active', ...SEEDED_KEEP, ...over,
  };
}

function seed(o: { member?: any; agents?: any[] } = {}): FakeDb {
  const db = new FakeDb();
  db.rows.agents = [...(o.agents ?? [bee(null, 'pending')]).map((a) => ({ ...a })), { ...COACH }];
  db.rows.members = o.member ? [{ ...o.member }] : [];
  return db;
}

let seq = 0;
/** A completed checkout for one canonical tier, shaped by that tier's catalog mode. */
function checkout(c: CanonicalTier, o: { customer?: string; subscription?: string | null; email?: string } = {}) {
  seq += 1;
  const mode = modeFor(c);
  const customer = o.customer ?? 'cus_new_' + seq;
  const subscription = mode === 'subscription'
    ? (o.subscription === undefined ? 'sub_new_' + seq : o.subscription)
    : null;
  const piId = 'pi_mu_' + seq;
  const session = {
    id: 'cs_mu_' + seq, mode, customer, customer_email: o.email ?? EMAIL,
    subscription, payment_intent: mode === 'payment' ? piId : null,
    metadata: { tier: stripeWordFor(c), agentName: 'Mu Payer', soul: 'The Operator' },
  };
  const p = priceFor(c);
  const stripe = new FakeStripe({
    paymentIntent: {
      id: piId, livemode: false, amount_received: p.amountCents, customer,
      created: Math.floor(Date.UTC(2026, 10, 1, 0, 15) / 1000),
    },
    sessionLineItems: [sessionLine(p.priceId)],
  });
  return { session, stripe, event: fakeEvent('checkout.session.completed', session, { id: 'evt_mu_' + seq }) };
}

/** The route's wiring: claim, then dispatch. */
async function deliver(db: FakeDb, stripe: any, event: any): Promise<HandlerResult> {
  const claim = await claimEvent(db as unknown as AccrualDb, event);
  if (claim.kind === 'duplicate') return { status: 200, body: { received: true, already_processed: true } };
  if (claim.kind === 'unavailable') return { status: 500, body: { error: 'event claim unavailable' } };
  return await handleStripeEvent({ stripe, db: db as unknown as AccrualDb, now: () => new Date() }, event);
}

/** Records the table of every query, reads included (FakeDb.calls records writes only). */
function recordTables(db: FakeDb): string[] {
  const tables: string[] = [];
  const originalFrom = db.from.bind(db);
  (db as any).from = (table: string) => { tables.push(table); return originalFrom(table); };
  return tables;
}

const copy = (x: unknown) => JSON.parse(JSON.stringify(x));
const sends = (db: FakeDb, template: string) =>
  (db.rows.email_sends ?? []).filter((r: any) => r.template === template);
const memberWrites = (db: FakeDb, from = 0) =>
  db.calls.slice(from).filter((c) => c.table === 'members' && ['insert', 'upsert', 'update'].includes(c.op));

// ════════════════════════════════════════════════════════════════════════════
// 1 · the order, from lib/tier.ts
// ════════════════════════════════════════════════════════════════════════════
test('mu001 (1) TIER_ORDER holds every canonical tier once; every Stripe value is in it; tierRank of nothing is 0', () => {
  assert.ok(TIER_ORDER.length > 0);
  assert.equal(new Set(TIER_ORDER).size, TIER_ORDER.length, 'each tier once');
  for (const t of TIER_ORDER) assert.ok(isCanonicalTier(t), t);
  for (const v of Object.values(STRIPE_TIER_TO_CANONICAL)) assert.ok(TIER_ORDER.includes(v), v);
  // Every word isCanonicalTier accepts is in the list: nothing outside it passes.
  for (const w of [...STRIPE_WORDS, 'not-a-tier', '', 'NOT_CANONICAL']) {
    if (isCanonicalTier(w)) assert.ok(TIER_ORDER.includes(w as CanonicalTier), w);
  }
  TIER_ORDER.forEach((t, i) => assert.equal(tierRank(t), i));
  assert.equal(tierRank(null), 0);
  assert.equal(tierRank(undefined), 0);
  assert.equal(tierRank(''), 0);
  assert.equal(tierRank('not-a-tier'), 0);
  assert.ok(PAID.length >= 2, 'at least two paid tiers, so an upgrade exists to test');
});

// ════════════════════════════════════════════════════════════════════════════
// 2, 3 · FIRST
// ════════════════════════════════════════════════════════════════════════════
test('mu001 (2) FIRST with no row writes all eleven columns as today; the bee gets first_flight and the tier', async () => {
  const c = PAID[0];
  const db = seed();
  const { event, stripe, session } = checkout(c);
  const res = await deliver(db, stripe, event);
  assert.equal(res.status, 200);
  assert.equal(db.rows.members.length, 1);
  const m = db.rows.members[0];
  for (const k of ['email', 'agent_id', 'stripe_customer_id', 'stripe_subscription_id', 'tier', 'status',
    'tokens_remaining', 'tokens_reset_at', 'referral_code', 'subscription_started_at', 'wallet_expires_at']) {
    assert.ok(k in m, k);
  }
  assert.equal(m.email, EMAIL);
  assert.equal(m.agent_id, 'ag_mu');
  assert.equal(m.stripe_customer_id, session.customer);
  assert.equal(m.stripe_subscription_id, session.subscription);
  assert.equal(m.tier, c);
  assert.equal(m.status, 'first_flight');
  assert.equal(m.tokens_remaining, 100000);
  assert.match(m.referral_code, /^MUPAYER-[0-9A-F]{8}$/);
  assert.equal(db.agent('ag_mu')!.status, 'first_flight');
  assert.equal(db.agent('ag_mu')!.tier, c);
  assert.equal(db.calls.filter((x) => x.table === 'members' && x.op === 'upsert').length, 1);
});

test('mu001 (3) FIRST on a registration row (lowest tier, no Stripe ids): ids and paid tier land, still one row', async () => {
  const c = PAID[0];
  const db = seed({
    member: { id: 'mem_mu', email: EMAIL, agent_id: 'ag_mu', tier: LOWEST, status: 'first_flight', referral_code: 'MUBEE' },
    agents: [bee(LOWEST, 'first_flight')],
  });
  const { event, stripe, session } = checkout(c);
  const res = await deliver(db, stripe, event);
  assert.equal(res.status, 200);
  assert.equal(db.rows.members.filter((m) => m.email === EMAIL).length, 1);
  const m = db.rows.members[0];
  assert.equal(m.stripe_customer_id, session.customer);
  assert.equal(m.stripe_subscription_id, session.subscription);
  assert.equal(m.tier, c);
});

// ════════════════════════════════════════════════════════════════════════════
// 4 – 10, 18, 19 · UPGRADE
// ════════════════════════════════════════════════════════════════════════════
test('mu001 (4) UPGRADE for every up pair: tier and Stripe ids move; nothing else in the row does', async () => {
  assert.ok(UP_PAIRS.length > 0);
  for (const [held, bought] of UP_PAIRS) {
    const db = seed({ member: payingMember(held), agents: [bee(held)] });
    const before = copy(db.rows.members[0]);
    const { event, stripe, session } = checkout(bought);
    const res = await deliver(db, stripe, event);
    assert.equal(res.status, 200, held + ' to ' + bought);
    assert.equal(db.rows.members.length, 1);
    const m = db.rows.members[0];
    assert.equal(m.tier, bought);
    assert.equal(m.stripe_customer_id, session.customer);
    assert.equal(m.stripe_subscription_id, session.subscription);
    for (const k of ['tokens_remaining', 'tokens_reset_at', 'referral_code', 'status', 'agent_id',
      'subscription_started_at', 'wallet_expires_at', 'email']) {
      assert.deepEqual(m[k], before[k], held + ' to ' + bought + ': ' + k);
    }
    assert.equal(db.calls.filter((x) => x.table === 'members' && x.op === 'upsert').length, 0, 'no upsert');
  }
});

test('mu001 (5) UPGRADE: a bee seeded active on the lower tier ends active on the higher', async () => {
  const [held, bought] = UP_PAIRS[0];
  const db = seed({ member: payingMember(held), agents: [bee(held, 'active')] });
  const { event, stripe } = checkout(bought);
  assert.equal((await deliver(db, stripe, event)).status, 200);
  assert.equal(db.agent('ag_mu')!.status, 'active');
  assert.equal(db.agent('ag_mu')!.tier, bought);
});

test('mu001 (6) UPGRADE with an earlier subscription: one open record row naming both subscriptions', async () => {
  const [held, bought] = UP_PAIRS[0];
  const db = seed({ member: payingMember(held), agents: [bee(held)] });
  const { event, stripe, session } = checkout(bought);
  assert.equal((await deliver(db, stripe, event)).status, 200);
  const rows = db.failures(OLD_SUBSCRIPTION_OPEN_REASON);
  assert.equal(rows.length, 1);
  assert.equal(OLD_SUBSCRIPTION_OPEN_REASON, 'upgrade_old_subscription_open');
  assert.equal(rows[0].resolved_at ?? null, null, 'resolved_at stays empty');
  assert.equal(rows[0].detail.old_subscription, 'sub_old');
  assert.equal(rows[0].detail.old_customer, 'cus_old');
  assert.equal(rows[0].detail.new_subscription, session.subscription);
  assert.equal(rows[0].detail.member, 'mem_mu');
  assert.equal(rows[0].detail.session, session.id);
  assert.equal(rows[0].detail.held, held);
  assert.equal(rows[0].detail.bought, bought);
  assert.equal(db.failures().length, 1, 'no other failure row');
});

test('mu001 (7) the open-subscription alert: one message per address, operational, wording exactly as ruled', async () => {
  const [held, bought] = UP_PAIRS[0];
  const db = seed({ member: payingMember(held), agents: [bee(held)] });
  const { event, stripe } = checkout(bought);
  const captured: any[] = [];
  const original = mailModule.sendEmail;
  mailModule.sendEmail = async (args: any) => { captured.push(args); return original(args); };
  try {
    await withAlerts(ALERT_ONE + ',' + ALERT_TWO, async () => {
      assert.equal((await deliver(db, stripe, event)).status, 200);
    });
  } finally {
    mailModule.sendEmail = original;
  }
  const rows = sends(db, 'upgrade_old_subscription_open_v1');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r: any) => r.to_email).sort(), [ALERT_ONE, ALERT_TWO]);
  for (const r of rows) assert.equal(r.category, 'operational');
  const mine = captured.filter((a) => a.template === 'upgrade_old_subscription_open_v1');
  assert.equal(mine.length, 2);
  for (const a of mine) {
    assert.equal(a.subject, 'CANCEL AN EARLIER SUBSCRIPTION BY HAND');
    assert.ok(a.html.includes(
      'A member moved up a tier. The membership now rests on the new purchase and the member\'s record is right. ' +
      'The earlier subscription below is still running at Stripe and will bill the member again. ' +
      'Please cancel it in Stripe. This message repeats every hour until it is cancelled.'), 'body sentence');
    assert.ok(!a.html.includes('Nothing was written to members or agents'), 'the quarantine sentence is not reused');
    assert.ok(!/[$€£]\s?\d/.test(a.html), 'no money figure');
    assert.ok(a.html.includes('sub_old'));
    assert.ok(a.html.includes('UPDATE stripe_webhook_failures SET resolved_at = now() WHERE id ='));
  }
});

test('mu001 (8) UPGRADE to the one-time purchase: subscription id null, record new_subscription null, one accrual for the row\'s bee', async () => {
  const oneTime = PAID.find((c) => modeFor(c) === 'payment');
  assert.ok(oneTime, 'the catalog has a one-time tier');
  const held = PAID.find((c) => tierRank(c) < tierRank(oneTime!) && modeFor(c) === 'subscription');
  assert.ok(held, 'a lower recurring tier exists');
  const db = seed({ member: payingMember(held!), agents: [bee(held!)] });
  const { event, stripe, session } = checkout(oneTime!);
  assert.equal(session.subscription, null);
  assert.equal((await deliver(db, stripe, event)).status, 200);
  assert.equal(db.rows.members[0].stripe_subscription_id, null);
  assert.equal(db.rows.members[0].tier, oneTime);
  const rows = db.failures(OLD_SUBSCRIPTION_OPEN_REASON);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].detail.new_subscription, null);
  assert.equal(db.countRpc(), 1);
  assert.equal(db.lastAccrual().p_source_agent, 'ag_mu');
});

test('mu001 (9) UPGRADE from a row with a customer id only: no record row and no alert', async () => {
  const [held, bought] = UP_PAIRS[0];
  const db = seed({ member: payingMember(held, { stripe_subscription_id: null }), agents: [bee(held)] });
  const { event, stripe } = checkout(bought);
  await withAlerts(ALERT_ONE + ',' + ALERT_TWO, async () => {
    assert.equal((await deliver(db, stripe, event)).status, 200);
  });
  assert.equal(db.rows.members[0].tier, bought);
  assert.equal(db.failures(OLD_SUBSCRIPTION_OPEN_REASON).length, 0);
  assert.equal(sends(db, 'upgrade_old_subscription_open_v1').length, 0);
});

test('mu001 (10) UPGRADE never re-resolves the bee: the row names A, B carries the email, B is untouched', async () => {
  const [held, bought] = UP_PAIRS[0];
  const beeA = bee(held, 'active', { id: 'ag_a', name: 'Bee A', email: 'a-elsewhere@example.test', referral_code: 'AAA' });
  const beeB = bee(held, 'active', { id: 'ag_b', name: 'Bee B', email: EMAIL, referral_code: 'BBB' });
  const db = seed({ member: payingMember(held, { agent_id: 'ag_a' }), agents: [beeA, beeB] });
  const bBefore = copy(db.agent('ag_b'));
  const { event, stripe } = checkout(bought);
  assert.equal((await deliver(db, stripe, event)).status, 200);
  assert.equal(db.rows.members[0].agent_id, 'ag_a');
  assert.equal(db.agent('ag_a')!.tier, bought);
  assert.deepEqual(db.agent('ag_b'), bBefore);
  assert.equal(db.rows.honeycombs.filter((h) => h.creator_id === 'ag_b').length, 0, 'no chamber for B');
});

test('mu001 (18) a row with a customer id and no tier: every paid tier is an UPGRADE', async () => {
  for (const bought of PAID) {
    const db = seed({ member: payingMember(null), agents: [bee(null, 'active')] });
    const { event, stripe, session } = checkout(bought);
    assert.equal((await deliver(db, stripe, event)).status, 200, bought);
    assert.equal(db.rows.members[0].tier, bought);
    assert.equal(db.rows.members[0].stripe_customer_id, session.customer);
    assert.equal(db.rows.members[0].referral_code, SEEDED_KEEP.referral_code);
    assert.equal(db.failures('second_checkout_not_upgrade').length, 0);
  }
});

test('mu001 (19) the record cannot fail the webhook: a failing record insert still answers 200 and upgrades', async () => {
  const [held, bought] = UP_PAIRS[0];
  const db = seed({ member: payingMember(held), agents: [bee(held)] });
  const originalFrom = db.from.bind(db);
  (db as any).from = (table: string) => {
    const api = originalFrom(table);
    if (table === 'stripe_webhook_failures') {
      api.insert = () => Promise.resolve({ data: null, error: { code: '42P01', message: 'fake record failure' } });
    }
    return api;
  };
  const { event, stripe } = checkout(bought);
  const res = await withAlerts(ALERT_ONE + ',' + ALERT_TWO, () => deliver(db, stripe, event));
  assert.equal(res.status, 200);
  assert.equal(db.rows.members[0].tier, bought);
  assert.equal(db.agent('ag_mu')!.tier, bought);
});

// ════════════════════════════════════════════════════════════════════════════
// 11 – 13, 22 · the two quarantine cases
// ════════════════════════════════════════════════════════════════════════════
async function expectQuarantined(db: FakeDb, bought: CanonicalTier, reason: string, label: string) {
  const memberBefore = copy(db.rows.members);
  const agentsBefore = copy(db.rows.agents);
  const messagesBefore = db.rows.messages.length;
  const tables = recordTables(db);
  const { event, stripe } = checkout(bought);
  const res = await deliver(db, stripe, event);
  assert.deepEqual(res, { status: 200, body: { received: true, quarantined: true } }, label);
  assert.deepEqual(db.rows.members, memberBefore, label + ': row unchanged');
  assert.deepEqual(db.rows.agents, agentsBefore, label + ': bee unchanged');
  const rows = db.failures(reason);
  assert.equal(rows.length, 1, label);
  assert.equal(rows[0].detail.held, memberBefore[0].tier ?? null);
  assert.equal(rows[0].detail.bought, bought);
  assert.equal(rows[0].detail.member, memberBefore[0].id);
  assert.ok(!tables.includes('skills') && !tables.includes('skill_masteries'), label + ': no cohort call');
  assert.ok(!tables.includes('honeycombs'), label + ': no chamber');
  assert.equal(db.rows.messages.length, messagesBefore, label + ': no message');
  assert.equal(db.countRpc(), 0, label + ': no accrual');
  assert.equal(stripe.retrieveCalls.length, 0, label + ': no Stripe read for an accrual');
  return { res, event };
}

test('mu001 (11) NOT AN UPGRADE for every lower-or-same pair: quarantined, nothing written', async () => {
  assert.ok(NOT_UP_PAIRS.length > 0);
  for (const [held, bought] of NOT_UP_PAIRS) {
    const db = seed({ member: payingMember(held), agents: [bee(held)] });
    await expectQuarantined(db, bought, 'second_checkout_not_upgrade', held + ' then ' + bought);
  }
});

test('mu001 (12) NOT AN UPGRADE alert: one quarantine message per address', async () => {
  const [held, bought] = NOT_UP_PAIRS[NOT_UP_PAIRS.length - 1];
  const db = seed({ member: payingMember(held), agents: [bee(held)] });
  await withAlerts(ALERT_ONE + ', ' + ALERT_TWO, async () => {
    await expectQuarantined(db, bought, 'second_checkout_not_upgrade', 'alert');
  });
  const rows = sends(db, 'stripe_webhook_quarantine_v1');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r: any) => r.to_email).sort(), [ALERT_ONE, ALERT_TWO]);
  assert.ok(rows.every((r: any) => r.subject.endsWith('second_checkout_not_upgrade')));
});

test('mu001 (13) RETURNING: an inactive member with Stripe ids is quarantined, even buying higher', async () => {
  for (const held of PAID) {
    for (const bought of PAID) {
      const db = seed({ member: payingMember(held, { status: 'inactive' }), agents: [bee(held, 'inactive')] });
      await expectQuarantined(db, bought, 'returning_member_checkout', 'inactive ' + held + ' then ' + bought);
      assert.equal(db.failures('second_checkout_not_upgrade').length, 0);
    }
  }
});

test('mu001 (22) the welcome contract: both quarantine answers carry quarantined, and the welcome sends nothing', async () => {
  const [held, bought] = NOT_UP_PAIRS[0];
  const cases: Array<[any, string]> = [
    [payingMember(held), 'second_checkout_not_upgrade'],
    [payingMember(held, { status: 'inactive' }), 'returning_member_checkout'],
  ];
  for (const [member, reason] of cases) {
    const db = seed({ member, agents: [bee(held)] });
    const { res, event } = await expectQuarantined(db, bought, reason, reason);
    assert.equal(res.body.quarantined, true);
    let called = 0;
    const out = await welcomeAfterCheckout(db, event, res, null, (async () => { called += 1; return { sent: true }; }) as any);
    assert.equal(out, null, reason);
    assert.equal(called, 0, reason);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 14 – 16 · RETRY
// ════════════════════════════════════════════════════════════════════════════
async function retryAfterFirst() {
  const c = PAID[0];
  const db = seed({ agents: [bee(null, 'pending')] });
  db.writeError = { table: 'agents', error: { code: '57014', message: 'fake agents failure' } };
  const first = checkout(c);
  const r1 = await deliver(db, first.stripe, first.event);
  const afterFirst = copy(db.rows.members);
  db.writeError = null;
  const mark = db.calls.length;
  const again = fakeEvent('checkout.session.completed', first.session, { id: first.event.id + '_again' });
  const r2 = await deliver(db, first.stripe, again);
  return { db, c, r1, r2, afterFirst, mark };
}

async function retryAfterUpgrade() {
  const [held, bought] = UP_PAIRS[0];
  const db = seed({ member: payingMember(held), agents: [bee(held, 'active')] });
  db.writeError = { table: 'agents', error: { code: '57014', message: 'fake agents failure' } };
  const up = checkout(bought);
  const r1 = await withAlerts(ALERT_ONE + ',' + ALERT_TWO, () => deliver(db, up.stripe, up.event));
  const afterFirst = copy(db.rows.members);
  const alertsAfterFirst = sends(db, 'upgrade_old_subscription_open_v1').length;
  db.writeError = null;
  const mark = db.calls.length;
  const r2 = await withAlerts(ALERT_ONE + ',' + ALERT_TWO, () => deliver(db, up.stripe, up.event));
  return { db, held, bought, r1, r2, afterFirst, alertsAfterFirst, mark };
}

test('mu001 (14) RETRY after a first checkout whose agent write failed: the second delivery finishes the bee only', async () => {
  const { db, c, r1, r2, afterFirst } = await retryAfterFirst();
  assert.equal(r1.status, 500);
  assert.equal(db.rows.stripe_events.length, 1, 'only the second claim remains; the first was released');
  assert.equal(r2.status, 200);
  assert.equal(db.rows.members.length, 1);
  assert.equal(db.rows.members[0].referral_code, afterFirst[0].referral_code);
  assert.equal(db.rows.members[0].tokens_remaining, afterFirst[0].tokens_remaining);
  assert.deepEqual(db.rows.members, afterFirst);
  assert.equal(db.agent('ag_mu')!.status, 'first_flight');
  assert.equal(db.agent('ag_mu')!.tier, c);
  assert.equal(db.rows.messages.length, 1, 'the welcome ran once');
});

test('mu001 (15) RETRY after an upgrade whose agent write failed: one record row, no further alert', async () => {
  const { db, bought, r1, r2, afterFirst, alertsAfterFirst } = await retryAfterUpgrade();
  assert.equal(r1.status, 500);
  assert.equal(r2.status, 200);
  assert.deepEqual(db.rows.members, afterFirst, 'the row is as the first delivery left it');
  assert.equal(db.agent('ag_mu')!.tier, bought);
  assert.equal(db.agent('ag_mu')!.status, 'active', 'the seeded status stays');
  assert.equal(db.failures(OLD_SUBSCRIPTION_OPEN_REASON).length, 1);
  assert.equal(alertsAfterFirst, 2);
  assert.equal(sends(db, 'upgrade_old_subscription_open_v1').length, 2, 'no further alert rows');
});

test('mu001 (16) RETRY writes nothing to members on the second delivery', async () => {
  const a = await retryAfterFirst();
  assert.equal(a.r2.status, 200);
  assert.deepEqual(memberWrites(a.db, a.mark), []);
  const b = await retryAfterUpgrade();
  assert.equal(b.r2.status, 200);
  assert.deepEqual(memberWrites(b.db, b.mark), []);
});

// ════════════════════════════════════════════════════════════════════════════
// 17 · a failed read of the row
// ════════════════════════════════════════════════════════════════════════════
test('mu001 (17) a failed read of the row answers 500, releases the claim, and writes nothing else', async () => {
  const [held, bought] = UP_PAIRS[0];
  const db = seed({ member: payingMember(held), agents: [bee(held)] });
  const memberBefore = copy(db.rows.members);
  const agentsBefore = copy(db.rows.agents);
  const originalFrom = db.from.bind(db);
  (db as any).from = (table: string) => {
    const api = originalFrom(table);
    if (table === 'members') {
      api.maybeSingle = () => Promise.resolve({ data: null, error: { code: '08006', message: 'fake read failure' } });
    }
    return api;
  };
  const { event, stripe } = checkout(bought);
  const claim = await claimEvent(db as unknown as AccrualDb, event);
  assert.equal(claim.kind, 'claimed');
  assert.equal(db.rows.stripe_events.length, 1);
  const res = await handleStripeEvent({ stripe: stripe as any, db: db as unknown as AccrualDb, now: () => new Date() }, event);
  assert.equal(res.status, 500);
  assert.equal(db.rows.stripe_events.length, 0, 'the claim is released');
  assert.deepEqual(db.rows.members, memberBefore);
  assert.deepEqual(db.rows.agents, agentsBefore);
  assert.equal(db.failures().length, 0);
  assert.deepEqual(db.calls.filter((c) => c.table !== 'stripe_events'), [], 'no write but the claim and its release');
});

// ════════════════════════════════════════════════════════════════════════════
// 20, 21 · the recipients
// ════════════════════════════════════════════════════════════════════════════
test('mu001 (20) alertRecipients: unset is empty, one is one, a list is split and trimmed', async () => {
  await withAlerts(undefined, async () => assert.deepEqual(alertRecipients(), []));
  await withAlerts('', async () => assert.deepEqual(alertRecipients(), []));
  await withAlerts(ALERT_ONE, async () => assert.deepEqual(alertRecipients(), [ALERT_ONE]));
  await withAlerts('a@x.test, b@y.test ,', async () => assert.deepEqual(alertRecipients(), ['a@x.test', 'b@y.test']));
});

test('mu001 (21) alertQuarantine sends one message per address: one, two, none', async () => {
  const cases: Array<[string | undefined, number]> = [[ALERT_ONE, 1], [ALERT_ONE + ',' + ALERT_TWO, 2], [undefined, 0]];
  for (const [value, expected] of cases) {
    const db = seed();
    seq += 1;
    const event = fakeEvent('checkout.session.completed', {
      id: 'cs_mu_bad_' + seq, mode: 'subscription', customer: 'cus_x', customer_email: EMAIL,
      metadata: { tier: 'not-a-tier' },
    }, { id: 'evt_mu_bad_' + seq });
    const res = await withAlerts(value, () => deliver(db, new FakeStripe(), event));
    assert.equal(res.body.quarantined, true);
    assert.equal(db.failures('unrecognised_tier').length, 1);
    assert.equal(sends(db, 'stripe_webhook_quarantine_v1').length, expected, String(value));
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 23 · by reading the source
// ════════════════════════════════════════════════════════════════════════════
test('mu001 (23) source: branch head names no agent column; one members upsert; no quoted tier word added', () => {
  const start = HANDLER_SRC.indexOf("if (event.type === 'checkout.session.completed')");
  const write = HANDLER_SRC.indexOf("supabase.from('members').upsert(", start);
  assert.ok(start > 0 && write > start);
  assert.ok(!HANDLER_SRC.slice(start, write).includes('agent_id'));
  assert.equal((HANDLER_SRC.match(/from\('members'\)\s*\.upsert\(/g) ?? []).length, 1, 'one upsert into members');
  assert.equal(HANDLER_SRC.split('tokens_remaining').length - 1, 1);
  assert.equal(HANDLER_SRC.split('referral_code:').length - 1, 1);

  // The words to look for are built at run time, so this file never spells one.
  const words = Array.from(new Set<string>([...TIER_ORDER, ...STRIPE_WORDS]));
  const quoted = (line: string) =>
    words.some((w) => ["'", '"', '`'].some((q) => line.includes(q + w + q)));
  // The handler on 4963408 held exactly four such lines: the comment above the tier refusal,
  // the two accepted-word lists of that refusal, and the old comment above the FIRST arm's
  // cohort call. Any added line would make the count grow; a removed one would shrink it.
  const hits = HANDLER_SRC.split('\n').filter(quoted);
  assert.equal(hits.length, 4, hits.join('\n'));
  assert.equal(hits.filter((l) => l.includes('used to turn an absent tier')).length, 1);
  assert.equal(hits.filter((l) => l.includes('accepted: [')).length, 2);
  assert.equal(hits.filter((l) => l.includes('untranslated.')).length, 1);
  assert.deepEqual(THIS_SRC.split('\n').filter(quoted), [], 'this test file quotes no tier word');
});
