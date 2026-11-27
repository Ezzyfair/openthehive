// tests/rail/member-upsert-001-b.test.ts
// ----------------------------------------------------------------------------
// THE HIVE — MEMBER-UPSERT-001-b. Runs under the repo's rail test command:
//   npm run test:rail
//
// The alert for an earlier subscription left running repeats every hour and stops
// by itself when Stripe says it is over; a second one-time purchase is never read as
// a retry; and the quarantine table says which rows are failures and which to-dos.
//
// WHAT IS REAL AND WHAT IS STUBBED:
//   REAL    — lib/rail/upgrade-alerts.ts, lib/rail/webhook-handler.ts
//             (handleStripeEvent, claimEvent, alertOldSubscriptionOpen),
//             lib/tier.ts, lib/rail/catalog.ts, lib/mail/sendEmail.ts (with no mail
//             env it writes an email_sends row with status skipped_no_env and sends
//             nothing, which is how a test sees an alert).
//   STUBBED — FakeDb and FakeStripe from tests/rail/fakes.ts, as they are, and a clock.
//
// TIERS COME FROM THE CODE. No tier word and no price is written in this file: the
// tiers are read from TIER_ORDER, Stripe's word for each from
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
  OLD_SUBSCRIPTION_OPEN_REASON,
  type HandlerResult,
} from '../../lib/rail/webhook-handler';
import {
  openOldSubscriptionRows,
  sendOpenUpgradeAlerts,
  closeOldSubscriptionAlerts,
} from '../../lib/rail/upgrade-alerts';
import type { AccrualDb } from '../../lib/rail/accrual';
import {
  TIER_ORDER,
  tierRank,
  STRIPE_TIER_TO_CANONICAL,
  type CanonicalTier,
} from '../../lib/tier';
import { MEMBERSHIP_PRICES, type StripeMode } from '../../lib/rail/catalog';
import { FakeDb, FakeStripe, fakeEvent, sessionLine } from './fakes';

const nodeFs: any = require('node:fs');
const nodePath: any = require('node:path');
const nodeCrypto: any = require('node:crypto');

const REPO_ROOT: string = nodePath.resolve(__dirname, '..', '..', '..');
const read = (...p: string[]): string => nodeFs.readFileSync(nodePath.join(REPO_ROOT, ...p), 'utf8');
const HANDLER_SRC = read('lib', 'rail', 'webhook-handler.ts');
const ROUTE_SRC = read('app', 'api', 'cron', 'upgrade-alerts', 'route.ts');
const THIS_SRC = read('tests', 'rail', 'member-upsert-001-b.test.ts');

// ── environment: fake price ids by NAME, no mail env, no alert address ─────
MEMBERSHIP_PRICES.forEach((p, i) => { process.env[p.priceIdEnvVar] = 'price_fake_mu001b_' + i; });
delete process.env.RESEND_API_KEY;
delete process.env.RESEND_FROM_EMAIL;
delete process.env.HIVE_ALERT_EMAIL;

const ALERT_ONE = 'alert-one@example.test';
const ALERT_TWO = 'alert-two@example.test';
const BOTH = ALERT_ONE + ',' + ALERT_TWO;

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

function stripeWordFor(c: CanonicalTier): string {
  const w = STRIPE_WORDS.find((k) => STRIPE_TIER_TO_CANONICAL[k] === c);
  assert.ok(w, 'every paid tier has a Stripe word');
  return w!;
}
function priceFor(c: CanonicalTier) {
  const i = MEMBERSHIP_PRICES.findIndex((p) => p.tier === stripeWordFor(c));
  assert.ok(i >= 0, 'every paid tier is in the catalog');
  return { ...MEMBERSHIP_PRICES[i], priceId: 'price_fake_mu001b_' + i };
}
const modeFor = (c: CanonicalTier): StripeMode => priceFor(c).mode;

const ONE_TIME: CanonicalTier[] = PAID.filter((c) => modeFor(c) === 'payment');
const RECURRING: CanonicalTier[] = PAID.filter((c) => modeFor(c) === 'subscription');

// ── the colony under test ───────────────────────────────────────────────────
const EMAIL = 'mu-b-payer@example.test';
const COACH = { id: 'ag_atlas', name: 'ATLAS', referral_code: 'ATLAS', status: 'active' };

function bee(tier: CanonicalTier | null, status = 'active', over: Record<string, unknown> = {}) {
  return {
    id: 'ag_mu', name: 'Mu Bee', email: EMAIL, soul: 'The Operator',
    referral_code: 'MUBEE', referred_by_code: null, status, tier, ...over,
  };
}

function memberRow(tier: CanonicalTier | null, over: Record<string, unknown> = {}) {
  return {
    id: 'mem_mu', email: EMAIL, agent_id: 'ag_mu',
    stripe_customer_id: 'cus_old', stripe_subscription_id: 'sub_old',
    tier, status: 'active',
    tokens_remaining: 4242, referral_code: 'KEEP-THIS-CODE',
    subscription_started_at: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

function seed(o: { member?: any; agents?: any[]; failures?: any[] } = {}): FakeDb {
  const db = new FakeDb();
  db.rows.agents = [...(o.agents ?? [bee(null, 'pending')]).map((a) => ({ ...a })), { ...COACH }];
  db.rows.members = o.member ? [{ ...o.member }] : [];
  db.rows.stripe_webhook_failures = (o.failures ?? []).map((f) => copy(f));
  return db;
}

let seq = 0;
/**
 * A completed checkout. The mode follows the tier's catalog mode unless `mode` is
 * given: tests 18 and 19 need a one-time session for a tier whose catalog mode is
 * recurring, because the catalog has only one one-time tier and the handler's
 * decision does not read the mode.
 */
function checkout(c: CanonicalTier, o: { customer?: string; subscription?: string | null; mode?: StripeMode } = {}) {
  seq += 1;
  const mode = o.mode ?? modeFor(c);
  const customer = o.customer ?? 'cus_new_' + seq;
  const subscription = mode === 'subscription'
    ? (o.subscription === undefined ? 'sub_new_' + seq : o.subscription)
    : null;
  const piId = 'pi_mub_' + seq;
  const session = {
    id: 'cs_mub_' + seq, mode, customer, customer_email: EMAIL,
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
  return { session, stripe, piId, event: fakeEvent('checkout.session.completed', session, { id: 'evt_mub_' + seq }) };
}

const NOW = new Date('2026-11-26T12:00:00.000Z');

/** The route's wiring: claim, then dispatch. */
async function deliver(db: FakeDb, stripe: any, event: any): Promise<HandlerResult> {
  const claim = await claimEvent(db as unknown as AccrualDb, event);
  if (claim.kind === 'duplicate') return { status: 200, body: { received: true, already_processed: true } };
  if (claim.kind === 'unavailable') return { status: 500, body: { error: 'event claim unavailable' } };
  return await handleStripeEvent({ stripe, db: db as unknown as AccrualDb, now: () => NOW }, event);
}

/** A subscription event, delivered through the handler. */
function subEvent(type: string, sub: Record<string, unknown>) {
  seq += 1;
  return fakeEvent(type, { object: 'subscription', ...sub }, { id: 'evt_sub_' + seq });
}

/** Records every eq filter by table, reads included (FakeDb.calls records writes only). */
function recordFilters(db: FakeDb): Array<[string, string]> {
  const seen: Array<[string, string]> = [];
  const originalFrom = db.from.bind(db);
  (db as any).from = (table: string) => {
    const api = originalFrom(table);
    const originalEq = api.eq;
    api.eq = (col: string, val: unknown) => { seen.push([table, col]); return originalEq(col, val); };
    return api;
  };
  return seen;
}

const copy = (x: unknown) => JSON.parse(JSON.stringify(x));
const sends = (db: FakeDb, template: string) =>
  (db.rows.email_sends ?? []).filter((r: any) => r.template === template);
const OPEN_TEMPLATE = 'upgrade_old_subscription_open_v1';
const QUARANTINE_TEMPLATE = 'stripe_webhook_quarantine_v1';
const memberWrites = (db: FakeDb, from = 0) =>
  db.calls.slice(from).filter((c) => c.table === 'members' && ['insert', 'upsert', 'update'].includes(c.op));

/** An open to-do row of the one reason, as MEMBER-UPSERT-001 writes it. */
function openRow(id: string, oldSub: string, createdAt: string, over: Record<string, unknown> = {}) {
  return {
    id, event_id: 'evt_up_' + id, event_type: 'checkout.session.completed',
    reason: OLD_SUBSCRIPTION_OPEN_REASON, kind: 'todo',
    detail: {
      session: 'cs_up_' + id, member: 'mem_mu', old_subscription: oldSub, old_customer: 'cus_old',
      new_subscription: 'sub_new', held: RECURRING[0], bought: RECURRING[RECURRING.length - 1],
    },
    created_at: createdAt, resolved_at: null, ...over,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 1 – 9 · lib/rail/upgrade-alerts.ts on its own
// ════════════════════════════════════════════════════════════════════════════
test('mu001b (1) openOldSubscriptionRows: only open rows of the reason, oldest first', async () => {
  const db = seed({
    failures: [
      openRow('f_new', 'sub_b', '2026-11-25T00:00:00.000Z'),
      openRow('f_old', 'sub_a', '2026-11-20T00:00:00.000Z'),
      openRow('f_closed', 'sub_c', '2026-11-19T00:00:00.000Z', { resolved_at: '2026-11-21T00:00:00.000Z' }),
      { ...openRow('f_other', 'sub_d', '2026-11-18T00:00:00.000Z'), reason: 'unrecognised_tier', kind: undefined },
      (() => { const r: any = openRow('f_absent', 'sub_e', '2026-11-22T00:00:00.000Z'); delete r.resolved_at; return r; })(),
    ],
  });
  const { rows, error } = await openOldSubscriptionRows(db);
  assert.equal(error, null);
  assert.deepEqual(rows.map((r) => r.id), ['f_old', 'f_absent', 'f_new']);
});

test('mu001b (2) sendOpenUpgradeAlerts: two open rows, two addresses, four rows with the ruled subject', async () => {
  const db = seed({
    failures: [openRow('f1', 'sub_a', '2026-11-20T00:00:00.000Z'), openRow('f2', 'sub_b', '2026-11-21T00:00:00.000Z')],
  });
  const result = await withAlerts(BOTH, () => sendOpenUpgradeAlerts(db));
  assert.deepEqual(result, { open: 2, error: null });
  const rows = sends(db, OPEN_TEMPLATE);
  assert.equal(rows.length, 4);
  assert.equal((db.rows.email_sends ?? []).length, 4, 'no other mail');
  for (const r of rows) {
    assert.equal(r.subject, 'CANCEL AN EARLIER SUBSCRIPTION BY HAND');
    assert.equal(r.status, 'skipped_no_env');
    assert.equal(r.category, 'operational');
  }
  assert.deepEqual(rows.map((r: any) => r.to_email).sort(), [ALERT_ONE, ALERT_ONE, ALERT_TWO, ALERT_TWO]);
});

test('mu001b (3) sendOpenUpgradeAlerts with no open row writes nothing and returns open 0', async () => {
  const db = seed({
    failures: [openRow('f1', 'sub_a', '2026-11-20T00:00:00.000Z', { resolved_at: '2026-11-21T00:00:00.000Z' })],
  });
  const result = await withAlerts(BOTH, () => sendOpenUpgradeAlerts(db));
  assert.deepEqual(result, { open: 0, error: null });
  assert.equal((db.rows.email_sends ?? []).length, 0);
});

test('mu001b (4) called twice it writes the rows twice: the repeat is the schedule\'s', async () => {
  const db = seed({
    failures: [openRow('f1', 'sub_a', '2026-11-20T00:00:00.000Z'), openRow('f2', 'sub_b', '2026-11-21T00:00:00.000Z')],
  });
  await withAlerts(BOTH, () => sendOpenUpgradeAlerts(db));
  assert.equal(sends(db, OPEN_TEMPLATE).length, 4);
  await withAlerts(BOTH, () => sendOpenUpgradeAlerts(db));
  assert.equal(sends(db, OPEN_TEMPLATE).length, 8);
});

test('mu001b (5) with HIVE_ALERT_EMAIL unset it writes no email_sends row and does not throw', async () => {
  const db = seed({ failures: [openRow('f1', 'sub_a', '2026-11-20T00:00:00.000Z')] });
  const result = await withAlerts(undefined, () => sendOpenUpgradeAlerts(db));
  assert.deepEqual(result, { open: 1, error: null });
  assert.equal((db.rows.email_sends ?? []).length, 0);
});

test('mu001b (6) a read error is returned in error and nothing is sent', async () => {
  const db = seed({ failures: [openRow('f1', 'sub_a', '2026-11-20T00:00:00.000Z')] });
  const fault = { code: '08006', message: 'fake read failure' };
  const originalFrom = db.from.bind(db);
  (db as any).from = (table: string) => {
    const api = originalFrom(table);
    if (table === 'stripe_webhook_failures') {
      api.select = () => ({ eq: () => Promise.resolve({ data: null, error: fault }) });
    }
    return api;
  };
  const result = await withAlerts(BOTH, () => sendOpenUpgradeAlerts(db));
  assert.equal(result.open, 0);
  assert.deepEqual(result.error, fault);
  assert.equal((db.rows.email_sends ?? []).length, 0);
});

test('mu001b (7) closeOldSubscriptionAlerts closes the one matching row and leaves the other open', async () => {
  const db = seed({
    failures: [openRow('f1', 'sub_a', '2026-11-20T00:00:00.000Z'), openRow('f2', 'sub_b', '2026-11-21T00:00:00.000Z')],
  });
  const closed = await closeOldSubscriptionAlerts(db, 'sub_a', NOW);
  assert.equal(closed, 1);
  const f1 = db.rows.stripe_webhook_failures.find((r) => r.id === 'f1');
  const f2 = db.rows.stripe_webhook_failures.find((r) => r.id === 'f2');
  assert.equal(f1.resolved_at, NOW.toISOString());
  assert.equal(f2.resolved_at, null);
});

test('mu001b (8) an id that matches nothing, or an empty id, closes nothing', async () => {
  for (const id of ['sub_nothing', '', undefined, null]) {
    const db = seed({
      failures: [openRow('f1', 'sub_a', '2026-11-20T00:00:00.000Z'), openRow('f2', 'sub_b', '2026-11-21T00:00:00.000Z')],
    });
    const before = copy(db.rows.stripe_webhook_failures);
    const closed = await closeOldSubscriptionAlerts(db, id as any, NOW);
    assert.equal(closed, 0, String(id));
    assert.deepEqual(db.rows.stripe_webhook_failures, before, String(id));
    assert.equal(db.calls.filter((c) => c.op === 'update').length, 0, String(id));
  }
});

test('mu001b (9) a write error on the table returns 0 and does not throw', async () => {
  const db = seed({ failures: [openRow('f1', 'sub_a', '2026-11-20T00:00:00.000Z')] });
  db.writeError = { table: 'stripe_webhook_failures', error: { code: '57014', message: 'fake write failure' } };
  const closed = await closeOldSubscriptionAlerts(db, 'sub_a', NOW);
  assert.equal(closed, 0);
  assert.equal(db.rows.stripe_webhook_failures[0].resolved_at, null);
});

// ════════════════════════════════════════════════════════════════════════════
// 10 – 15 · through the handler: Stripe speaks about a subscription
// ════════════════════════════════════════════════════════════════════════════
/** A member after an upgrade: the row holds the NEW ids; the to-do row names sub_old. */
function upgradedColony() {
  const top = RECURRING[RECURRING.length - 1];
  return seed({
    member: memberRow(top, { stripe_customer_id: 'cus_new', stripe_subscription_id: 'sub_new' }),
    agents: [bee(top, 'active')],
    failures: [openRow('f_open', 'sub_old', '2026-11-20T00:00:00.000Z')],
  });
}

async function earlierSubscriptionEnds(type: string, sub: Record<string, unknown>) {
  const db = upgradedColony();
  const membersBefore = copy(db.rows.members);
  const agentsBefore = copy(db.rows.agents);
  const res = await deliver(db, new FakeStripe(), subEvent(type, sub));
  return { db, res, membersBefore, agentsBefore };
}

test('mu001b (10) a deletion of the earlier subscription closes the row and leaves the member and bee alone', async () => {
  const { db, res, membersBefore, agentsBefore } =
    await earlierSubscriptionEnds('customer.subscription.deleted', { id: 'sub_old', status: 'canceled' });
  assert.equal(res.status, 200);
  assert.equal(db.rows.stripe_webhook_failures[0].resolved_at, NOW.toISOString());
  assert.deepEqual(db.rows.members, membersBefore);
  assert.deepEqual(db.rows.agents, agentsBefore);
});

test('mu001b (11) an update with status canceled: the same', async () => {
  const { db, res, membersBefore, agentsBefore } =
    await earlierSubscriptionEnds('customer.subscription.updated', { id: 'sub_old', status: 'canceled' });
  assert.equal(res.status, 200);
  assert.equal(db.rows.stripe_webhook_failures[0].resolved_at, NOW.toISOString());
  assert.deepEqual(db.rows.members, membersBefore);
  assert.deepEqual(db.rows.agents, agentsBefore);
});

test('mu001b (12) an update with cancel_at_period_end and status active closes the row; cancelMembership is not called', async () => {
  const { db, res, membersBefore } = await earlierSubscriptionEnds('customer.subscription.updated',
    { id: 'sub_old', status: 'active', cancel_at_period_end: true });
  assert.equal(res.status, 200);
  assert.equal(db.rows.stripe_webhook_failures[0].resolved_at, NOW.toISOString());
  assert.deepEqual(memberWrites(db), [], 'no update on members is recorded');
  assert.deepEqual(db.rows.members, membersBefore);
});

test('mu001b (13) an update with neither leaves the row open', async () => {
  const { db, res } = await earlierSubscriptionEnds('customer.subscription.updated',
    { id: 'sub_old', status: 'active', cancel_at_period_end: false });
  assert.equal(res.status, 200);
  assert.equal(db.rows.stripe_webhook_failures[0].resolved_at, null);
  assert.equal(db.calls.filter((c) => c.table === 'stripe_webhook_failures').length, 0);
});

test('mu001b (14) a deletion of the member\'s current subscription sets the member inactive, as today; the to-do row is untouched', async () => {
  const db = upgradedColony();
  const failuresBefore = copy(db.rows.stripe_webhook_failures);
  const res = await deliver(db, new FakeStripe(), subEvent('customer.subscription.deleted', { id: 'sub_new', status: 'canceled' }));
  assert.equal(res.status, 200);
  assert.equal(db.rows.members[0].status, 'inactive');
  assert.equal(db.agent('ag_mu')!.status, 'inactive');
  assert.deepEqual(db.rows.stripe_webhook_failures, failuresBefore);
});

test('mu001b (15) after the deletion of 10, the hourly send writes no row for that subscription', async () => {
  const { db } = await earlierSubscriptionEnds('customer.subscription.deleted', { id: 'sub_old', status: 'canceled' });
  const result = await withAlerts(BOTH, () => sendOpenUpgradeAlerts(db));
  assert.deepEqual(result, { open: 0, error: null });
  assert.equal(sends(db, OPEN_TEMPLATE).length, 0);
});

// ════════════════════════════════════════════════════════════════════════════
// 16, 17 · the route and the schedule, by reading them
// ════════════════════════════════════════════════════════════════════════════
test('mu001b (16) route source: four exports, CRON_SECRET only, no client built, unauthorized before railAdmin', () => {
  for (const name of ['runtime', 'dynamic', 'fetchCache', 'revalidate']) {
    assert.match(ROUTE_SRC, new RegExp('^export const ' + name + '\\s*=', 'm'), name);
  }
  assert.match(ROUTE_SRC, /export const runtime = 'nodejs';/);
  assert.match(ROUTE_SRC, /export const dynamic = 'force-dynamic';/);
  assert.match(ROUTE_SRC, /export const fetchCache = 'force-no-store';/);
  assert.match(ROUTE_SRC, /export const revalidate = 0;/);
  assert.ok(ROUTE_SRC.includes('CRON_SECRET'));
  const secretNames = Array.from(new Set(ROUTE_SRC.match(/\b[A-Z][A-Z0-9_]*SECRET[A-Z0-9_]*\b/g) ?? []));
  assert.deepEqual(secretNames, ['CRON_SECRET'], 'no other secret name');
  assert.ok(!ROUTE_SRC.includes('createClient('));
  const unauth = ROUTE_SRC.indexOf("'unauthorized'");
  const call = ROUTE_SRC.indexOf('railAdmin(');
  assert.ok(unauth > 0 && call > 0 && unauth < call, 'unauthorized is answered before railAdmin is called');
  assert.match(ROUTE_SRC, /import \{ railAdmin \} from '@\/lib\/rail\/db';/);
  assert.match(ROUTE_SRC, /\{ error: 'read_failed' \}, \{ status: 500 \}/);
  assert.match(ROUTE_SRC, /\{ status: 401 \}/);
});

test('mu001b (17) vercel.json: three entries, the new one hourly, the first two as on base', () => {
  const raw = read('vercel.json');
  const cfg = JSON.parse(raw);
  assert.equal(cfg.crons.length, 3);
  assert.deepEqual(cfg.crons[2], { path: '/api/cron/upgrade-alerts', schedule: '0 * * * *' });
  // The first two entries, byte for byte as they stand in vercel.json at base.
  const baseFirstTwo =
    '  "crons": [\n' +
    '    {\n      "path": "/api/scouts/pitch",\n      "schedule": "0 * * * *"\n    },\n' +
    '    {\n      "path": "/api/cron/antenna-prune",\n      "schedule": "0 4 * * *"\n    }';
  assert.ok(raw.includes(baseFirstTwo), 'the first two entries are byte-equal to base');
});

// ════════════════════════════════════════════════════════════════════════════
// 18 – 22 · MED-2: RETRY needs a subscription id
// ════════════════════════════════════════════════════════════════════════════
const TOP_ONE_TIME = ONE_TIME[ONE_TIME.length - 1];

/** A member whose row holds a customer id and no subscription id. */
function oneTimeColony(held: CanonicalTier) {
  return seed({
    member: memberRow(held, { stripe_customer_id: 'cus_once', stripe_subscription_id: null }),
    agents: [bee(held, 'active')],
  });
}

async function secondOneTime(held: CanonicalTier, bought: CanonicalTier) {
  const db = oneTimeColony(held);
  const membersBefore = copy(db.rows.members);
  const agentsBefore = copy(db.rows.agents);
  const { event, stripe, session, piId } = checkout(bought, { customer: 'cus_once', mode: 'payment' });
  assert.equal(session.subscription, null);
  const res = await withAlerts(BOTH, () => deliver(db, stripe, event));
  return { db, res, membersBefore, agentsBefore, piId };
}

function expectSecondPurchaseQuarantined(r: Awaited<ReturnType<typeof secondOneTime>>, label: string) {
  assert.deepEqual(r.res, { status: 200, body: { received: true, quarantined: true } }, label);
  assert.equal(r.db.failures('second_checkout_not_upgrade').length, 1, label);
  assert.equal(r.db.failures().length, 1, label + ': no other row');
  const alerts = sends(r.db, QUARANTINE_TEMPLATE);
  assert.deepEqual(alerts.map((a: any) => a.to_email).sort(), [ALERT_ONE, ALERT_TWO], label + ': one alert per address');
  assert.deepEqual(r.db.rows.members, r.membersBefore, label + ': members unchanged');
  assert.deepEqual(r.db.rows.agents, r.agentsBefore, label + ': agents unchanged');
  assert.equal(r.db.rows.messages.length, 0, label + ': no message row');
  assert.equal(r.db.countRpc('rail_accrue'), 0, label + ': no accrual');
}

test('mu001b (18) one-time, then one-time of the same tier under one customer: quarantined, not RETRY', async () => {
  assert.ok(TOP_ONE_TIME, 'the catalog has a one-time tier');
  const r = await secondOneTime(TOP_ONE_TIME, TOP_ONE_TIME);
  expectSecondPurchaseQuarantined(r, 'same tier');
});

test('mu001b (19) one-time, then a one-time session of a lower tier: quarantined', async () => {
  const lower = PAID.filter((c) => tierRank(c) < tierRank(TOP_ONE_TIME));
  assert.ok(lower.length > 0, 'a lower paid tier exists');
  for (const bought of lower) {
    const r = await secondOneTime(TOP_ONE_TIME, bought);
    expectSecondPurchaseQuarantined(r, 'lower ' + bought);
  }
});

test('mu001b (20) a one-time purchase of a higher tier after a held customer id with no subscription: UPGRADE', async () => {
  const held = PAID.find((c) => tierRank(c) < tierRank(TOP_ONE_TIME));
  assert.ok(held, 'a lower paid tier exists');
  const db = oneTimeColony(held!);
  const before = copy(db.rows.members[0]);
  const { event, stripe, piId } = checkout(TOP_ONE_TIME, { customer: 'cus_once' });
  const res = await withAlerts(BOTH, () => deliver(db, stripe, event));
  assert.equal(res.status, 200);
  assert.equal(res.body.quarantined, undefined);
  const writes = memberWrites(db);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].op, 'update');
  assert.deepEqual(Object.keys(writes[0].args as any).sort(), ['stripe_customer_id', 'stripe_subscription_id', 'tier']);
  const m = db.rows.members[0];
  assert.equal(m.tier, TOP_ONE_TIME);
  assert.equal(m.stripe_customer_id, 'cus_once');
  assert.equal(m.stripe_subscription_id, null);
  for (const k of Object.keys(before)) {
    if (['tier', 'stripe_customer_id', 'stripe_subscription_id'].includes(k)) continue;
    assert.deepEqual(m[k], before[k], k);
  }
  assert.equal(db.failures(OLD_SUBSCRIPTION_OPEN_REASON).length, 0);
  assert.equal(sends(db, OPEN_TEMPLATE).length, 0);
  assert.equal(db.countRpc('rail_accrue'), 1, 'one accrual');
  assert.equal(db.lastAccrual().p_invoice_ref, piId, 'for the new payment');
});

test('mu001b (21) a subscription checkout delivered a second time is still RETRY: nothing written to members', async () => {
  const held = RECURRING[0];
  const db = seed({
    member: memberRow(held, { stripe_customer_id: 'cus_sub', stripe_subscription_id: 'sub_held' }),
    agents: [bee(held, 'active')],
  });
  const membersBefore = copy(db.rows.members);
  const { event, stripe } = checkout(held, { customer: 'cus_sub', subscription: 'sub_held' });
  const res = await withAlerts(BOTH, () => deliver(db, stripe, event));
  assert.deepEqual(res, { status: 200, body: { received: true } });
  assert.deepEqual(memberWrites(db), []);
  assert.deepEqual(db.rows.members, membersBefore);
  assert.equal(db.failures().length, 0);
  assert.equal((db.rows.email_sends ?? []).length, 0);
});

test('mu001b (22) THE KNOWN COST OF ITEM 5: a retried one-time first checkout is quarantined for a person to finish', async () => {
  const db = seed({ agents: [bee(null, 'pending')] });
  db.writeError = { table: 'agents', error: { code: '57014', message: 'fake agents failure' } };
  const first = checkout(TOP_ONE_TIME);
  const r1 = await deliver(db, first.stripe, first.event);
  assert.equal(r1.status, 500, 'the first delivery failed at the agents update');
  assert.equal(db.rows.members.length, 1, 'after writing the member row');
  db.writeError = null;
  const beeBefore = copy(db.agent('ag_mu'));
  const again = fakeEvent('checkout.session.completed', first.session, { id: first.event.id + '_again' });
  const r2 = await withAlerts(BOTH, () => deliver(db, first.stripe, again));
  assert.deepEqual(r2, { status: 200, body: { received: true, quarantined: true } });
  assert.equal(db.failures('second_checkout_not_upgrade').length, 1);
  assert.deepEqual(db.agent('ag_mu'), beeBefore, 'the bee is unchanged');
  assert.equal(db.countRpc('rail_accrue'), 0, 'nothing accrued');
});

// ════════════════════════════════════════════════════════════════════════════
// 23 · MED-1: kind
// ════════════════════════════════════════════════════════════════════════════
test('mu001b (23) the to-do row carries kind todo; a quarantine row names no kind; the SQL and migrations say so', async () => {
  // Through the handler: an upgrade that leaves an earlier subscription running.
  const held = RECURRING[0];
  const bought = PAID.find((c) => tierRank(c) > tierRank(held))!;
  const db = seed({ member: memberRow(held), agents: [bee(held)] });
  const up = checkout(bought);
  assert.equal((await withAlerts(BOTH, () => deliver(db, up.stripe, up.event))).status, 200);
  const todoInserts = db.calls.filter((c) => c.table === 'stripe_webhook_failures' && c.op === 'insert');
  assert.equal(todoInserts.length, 1);
  assert.equal((todoInserts[0].args as any).reason, OLD_SUBSCRIPTION_OPEN_REASON);
  assert.equal((todoInserts[0].args as any).kind, 'todo');

  // A quarantine for a tier nobody can name: the insert names no kind (the default decides).
  const db2 = seed();
  seq += 1;
  const bad = fakeEvent('checkout.session.completed', {
    id: 'cs_mub_bad_' + seq, mode: 'subscription', customer: 'cus_x', customer_email: EMAIL,
    metadata: { tier: 'not-a-tier' },
  }, { id: 'evt_mub_bad_' + seq });
  assert.equal((await deliver(db2, new FakeStripe(), bad)).body.quarantined, true);
  const qInserts = db2.calls.filter((c) => c.table === 'stripe_webhook_failures' && c.op === 'insert');
  assert.equal(qInserts.length, 1);
  assert.equal((qInserts[0].args as any).reason, 'unrecognised_tier');
  assert.ok(!('kind' in (qInserts[0].args as any)), 'no kind field');

  // By reading the source.
  assert.equal(HANDLER_SRC.split("resolved_at IS NULL AND kind = \\'failure\\'").length - 1, 1, 'the email SQL, once');
  assert.equal(HANDLER_SRC.split("kind: 'todo'").length - 1, 1, 'one insert names a kind');

  const statements = (sql: string) => sql.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('--'));
  const up6 = statements(read('supabase', 'migrations', '20261125_webhook_failures_kind.sql'));
  assert.deepEqual(up6.slice(0, 4), [
    'BEGIN;',
    "ALTER TABLE stripe_webhook_failures ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'failure';",
    "UPDATE stripe_webhook_failures SET kind = 'todo' WHERE reason = 'upgrade_old_subscription_open';",
    'COMMIT;',
  ]);
  assert.equal(up6.length, 5);
  assert.ok(up6[4].startsWith('SELECT '), 'ends with one SELECT');
  assert.equal(up6.filter((l) => l.startsWith('SELECT')).length, 1);
  assert.ok(!/\bCHECK\b/.test(up6.join('\n')), 'no CHECK on kind');

  const down6 = statements(read('supabase', 'migrations', '20261125_webhook_failures_kind_rollback.sql'));
  assert.deepEqual(down6.slice(0, 3), ['BEGIN;', 'ALTER TABLE stripe_webhook_failures DROP COLUMN IF EXISTS kind;', 'COMMIT;']);
  assert.equal(down6.length, 4);
  assert.ok(down6[3].startsWith('SELECT '), 'ends with one SELECT');

  // The first migration: remove the added comment block and it is byte-equal to base.
  const first = read('supabase', 'migrations', '20260922_stripe_webhook_failures.sql');
  const added = [
    '-- AMENDED Nov 25, 2026 (MEMBER-UPSERT-001, MEMBER-UPSERT-001-b; NIK-MEMBER-UPSERT-001 MED-1).',
    '-- Two statements above are no longer the whole truth:',
    '--   * This table also holds TO-DO rows for events that SUCCEEDED (reason',
    "--     'upgrade_old_subscription_open'). The column kind, added by",
    "--     20261125_webhook_failures_kind.sql, tells the two apart: 'failure' (the default) or 'todo'.",
    '--   * The code DOES write resolved_at, for rows of that one reason only, when Stripe reports',
    '--     the earlier subscription over (Francis, ruling N2, Nov 22, 2026).',
    '--',
  ].join('\n') + '\n';
  assert.ok(added.split('\n').filter((l) => l !== '').every((l) => l.startsWith('--')));
  assert.equal(first.split(added).length - 1, 1, 'the amendment is there once');
  const restored = first.replace(added, '');
  const BASE_SHA256 = '5d832e270e56db22a24c1e06e5db05b8d529a79b5f48400a590d7abedacd9484';
  assert.equal(nodeCrypto.createHash('sha256').update(restored, 'utf8').digest('hex'), BASE_SHA256,
    'without the added comment lines the file is byte-equal to base');
});

// ════════════════════════════════════════════════════════════════════════════
// 24 · LOW-4: the stage Nikita named
// ════════════════════════════════════════════════════════════════════════════
test('mu001b (24) the bee read by id fails in UPGRADE and the claim release fails: 500, one claim_release_failed row, stage agent_read', async () => {
  const held = RECURRING[0];
  const bought = PAID.find((c) => tierRank(c) > tierRank(held))!;
  const db = seed({ member: memberRow(held), agents: [bee(held)] });
  const originalFrom = db.from.bind(db);
  (db as any).from = (table: string) => {
    const api = originalFrom(table);
    if (table === 'agents') {
      api.maybeSingle = () => Promise.resolve({ data: null, error: { code: '08006', message: 'fake bee read failure' } });
    }
    return api;
  };
  db.releaseError = { code: '08006', message: 'fake release failure' };
  const { event, stripe } = checkout(bought);
  const res = await deliver(db, stripe, event);
  assert.equal(res.status, 500);
  const rows = db.failures('claim_release_failed');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].detail.stage, 'agent_read');
});

// ════════════════════════════════════════════════════════════════════════════
// 25 · LOW-2: the bee is looked up by email only in FIRST
// ════════════════════════════════════════════════════════════════════════════
const agentEmailReads = (seen: Array<[string, string]>) =>
  seen.filter(([t, c]) => t === 'agents' && c === 'email').length;

/** The writes of a delivery with the volatile values (random code, clock) taken out. */
function normalisedWrites(db: FakeDb) {
  return db.calls.map((c) => {
    const args: any = c.args && typeof c.args === 'object' && !Array.isArray(c.args) ? { ...(c.args as any) } : c.args;
    if (args && typeof args === 'object' && !Array.isArray(args)) {
      for (const k of ['referral_code', 'tokens_reset_at', 'subscription_started_at', 'wallet_expires_at', 'last_activity_at']) {
        if (k in args) args[k] = '(volatile)';
      }
    }
    return { table: c.table, op: c.op, args };
  });
}

test('mu001b (25) no agents read on email in RETRY, UPGRADE, RETURNING or NOT AN UPGRADE; exactly one in FIRST, whose writes are unchanged', async () => {
  const low = RECURRING[0];
  const high = PAID.find((c) => tierRank(c) > tierRank(low))!;
  const cases: Array<[string, () => { db: FakeDb; co: ReturnType<typeof checkout> }]> = [
    ['retry', () => ({
      db: seed({ member: memberRow(low, { stripe_customer_id: 'cus_r', stripe_subscription_id: 'sub_r' }), agents: [bee(low)] }),
      co: checkout(low, { customer: 'cus_r', subscription: 'sub_r' }),
    })],
    ['upgrade', () => ({ db: seed({ member: memberRow(low), agents: [bee(low)] }), co: checkout(high) })],
    ['returning', () => ({ db: seed({ member: memberRow(low, { status: 'inactive' }), agents: [bee(low, 'inactive')] }), co: checkout(high) })],
    ['not_upgrade', () => ({ db: seed({ member: memberRow(high), agents: [bee(high)] }), co: checkout(low) })],
  ];
  for (const [label, make] of cases) {
    const { db, co } = make();
    const seen = recordFilters(db);
    const res = await deliver(db, co.stripe, co.event);
    assert.equal(res.status, 200, label);
    assert.equal(agentEmailReads(seen), 0, label);
  }

  // FIRST: one read on email, and the writes the parent ticket's FIRST fixture
  // (member-upsert-001 test 2: no row, the lowest paid tier) produced on base.
  const c = PAID[0];
  const db = seed();
  const seen = recordFilters(db);
  const { event, stripe, session } = checkout(c);
  assert.equal((await deliver(db, stripe, event)).status, 200);
  assert.equal(agentEmailReads(seen), 1, 'first');
  const writes = normalisedWrites(db);
  const expected = [
    { table: 'stripe_events', op: 'insert', args: { event_id: event.id, event_type: 'checkout.session.completed' } },
    { table: 'members', op: 'upsert', args: {
      email: EMAIL, agent_id: 'ag_mu', stripe_customer_id: session.customer, stripe_subscription_id: session.subscription,
      tier: c, status: 'first_flight', tokens_remaining: 100000, tokens_reset_at: '(volatile)',
      referral_code: '(volatile)', subscription_started_at: '(volatile)', wallet_expires_at: '(volatile)',
    } },
    { table: 'agents', op: 'update', args: { status: 'first_flight', tier: c } },
  ];
  assert.deepEqual(writes.slice(0, 3), expected);
  // After the bee: only the cohort, the chamber and the welcome, as on base.
  const rest = writes.slice(3).map((w) => w.table + ':' + w.op);
  for (const w of rest) {
    assert.ok(['skill_masteries:insert', 'skill_masteries:update', 'honeycombs:insert', 'messages:insert', 'honeycombs:update'].includes(w), w);
  }
  assert.ok(rest.includes('honeycombs:insert') && rest.includes('messages:insert') && rest.includes('honeycombs:update'));
  assert.equal(db.rows.messages.length, 1, 'the welcome ran once');
});

// ════════════════════════════════════════════════════════════════════════════
// 26 · this file quotes no tier word
// ════════════════════════════════════════════════════════════════════════════
test('mu001b (26) this test file quotes no tier word', () => {
  const words = Array.from(new Set<string>([...TIER_ORDER, ...STRIPE_WORDS]));
  const quoted = (line: string) => words.some((w) => ["'", '"', '`'].some((q) => line.includes(q + w + q)));
  assert.deepEqual(THIS_SRC.split('\n').filter(quoted), []);
});
