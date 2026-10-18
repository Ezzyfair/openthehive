// tests/rail/accrual.test.ts
// ----------------------------------------------------------------------------
// THE HIVE · payout rail — the row 4 gate.
// RAIL-DESIGN-v1.1 §15 row 4: "replay and concurrency self-test against the real
// handler with stubbed Stripe". Ticket NIK-RAIL-004.
//
// Run:  npm run test:rail
//   ==  npx tsc -p tests/rail/tsconfig.json --outDir .rail-test-dist \
//       && node --test '.rail-test-dist/**/*.test.js'
//
// ONE DEVIATION FROM THE COMMAND AS WRITTEN, measured: `node --test .rail-test-dist/`
// finds nothing. Node's test-file discovery skips dot-directories, so a directory
// argument beginning with '.' is loaded as if it were a single test FILE and the run
// dies with "Cannot find module .../.rail-test-dist" before any test executes
// (node v22.22.2, proven in the packet). The glob names the files directly, which
// works and keeps the output directory the ticket specified.
//
// WHAT IS REAL AND WHAT IS STUBBED, stated so the gate cannot be read as broader
// than it is:
//   REAL    — lib/rail/accrual.ts, lib/rail/webhook-handler.ts (claimEvent,
//             handleStripeEvent, recordWebhookFailure), lib/rail/catalog.ts and
//             lib/referral-engine.ts's buildReferralChain. The same functions the
//             route calls, not a re-implementation.
//   STUBBED — Stripe (three calls) and the database (the chain the handler uses).
//   NOT COVERED — the signature verification and the raw-body read, which live in
//             the route because only a route can do them, and rail_accrue itself,
//             which was proven against a real PostgreSQL in NIK-RAIL-002. This
//             file proves the TypeScript side calls it once, with integer cents,
//             and never swallows its error.
//
// No network, no Supabase, no Stripe. HIVE_ALERT_EMAIL is deleted below so the mail
// door is never opened; the price-id env vars are set to obvious fakes.
// ----------------------------------------------------------------------------
import './resolver'; // MUST stay first: installs the '@/...' require hook.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  utcFirstOfMonth,
  invoiceLinePriceId,
  sessionLinePriceId,
  accrueForSource,
  resolveOneTime,
  type AccrualDb,
} from '../../lib/rail/accrual';
import {
  claimEvent,
  handleStripeEvent,
  recordWebhookFailure,
  type HandlerResult,
} from '../../lib/rail/webhook-handler';
import {
  FakeDb, FakeStripe, fakeInvoice, fakeEvent, invoiceLine, sessionLine,
  fakeCharge, fakeDispute, fakeInvoicePayment,
} from './fakes';

// ── the environment the catalog reads by name ───────────────────────────────
const WORKER = 'price_fake_worker_004';
const HONEY = 'price_fake_honey_004';
const QUEENS = 'price_fake_queens_004';
process.env.STRIPE_WORKER_BEE_PRICE_ID = WORKER;
process.env.STRIPE_HONEY_MAKER_PRICE_ID = HONEY;
process.env.STRIPE_QUEENS_COUNCIL_PRICE_ID = QUEENS;
delete process.env.HIVE_ALERT_EMAIL; // no alert email leaves this test

// ── the colony under test ───────────────────────────────────────────────────
// ag_src pays. ag_one is its referrer (L1), ag_two is ag_one's referrer (L2).
// ag_three sits above ag_two and must NOT appear: R11, two levels and no more.
function seed(): FakeDb {
  const db = new FakeDb();
  db.rows.agents = [
    { id: 'ag_src', name: 'Source', email: 'src@example.test', soul: 'The Operator',
      referral_code: 'SRC', referred_by_code: 'ONE', status: 'active', tier: 'worker_bee' },
    { id: 'ag_one', name: 'Level One', referral_code: 'ONE', referred_by_code: 'TWO',
      status: 'active', tier: 'worker_bee' },
    { id: 'ag_two', name: 'Level Two', referral_code: 'TWO', referred_by_code: 'THREE',
      status: 'active', tier: 'honey_maker' },
    { id: 'ag_three', name: 'Level Three', referral_code: 'THREE', referred_by_code: null,
      status: 'active', tier: 'honey_maker' },
  ];
  db.rows.members = [
    { id: 'mem_1', email: 'src@example.test', agent_id: 'ag_src',
      stripe_customer_id: 'cus_test_1', stripe_subscription_id: 'sub_test_1', status: 'active' },
  ];
  return db;
}

/**
 * The route's wiring, and only the route's wiring: claim, answer a duplicate, record
 * and 500 an unavailable claim, otherwise dispatch. Every function it calls is the
 * real one — this stands in for NextResponse, which is all a test cannot have.
 * Kept to the same five branches as app/api/stripe/webhook/route.ts so a drift
 * between them is visible in one diff.
 */
async function deliver(
  db: FakeDb,
  stripe: any,
  event: any,
  now: () => Date = () => new Date(),
): Promise<HandlerResult> {
  const claim = await claimEvent(db as unknown as AccrualDb, event);
  if (claim.kind === 'duplicate') {
    return { status: 200, body: { received: true, already_processed: true } };
  }
  if (claim.kind === 'unavailable') {
    await recordWebhookFailure(db, {
      event_id: event.id, event_type: event.type, reason: 'claim_failed',
      detail: { code: claim.code, message: claim.message },
    });
    return { status: 500, body: { error: 'event claim unavailable' } };
  }
  return await handleStripeEvent(
    { stripe, db: db as unknown as AccrualDb, now },
    event,
  );
}

const invoiceEvent = (o: Parameters<typeof fakeInvoice>[0], ev?: { id?: string; ageSeconds?: number }) =>
  fakeEvent('invoice.payment_succeeded', fakeInvoice(o), ev);

// ════════════════════════════════════════════════════════════════════════════
// (a) the month comes from UTC, never the server's zone
// ════════════════════════════════════════════════════════════════════════════
test('(a) utcFirstOfMonth reads the UTC month, so a negative-offset server cannot shift it', () => {
  // 2026-10-01T00:30:00Z is still September 30 in New York. D4/R5 is exactly this bug.
  assert.equal(utcFirstOfMonth(Math.floor(Date.UTC(2026, 9, 1, 0, 30) / 1000)), '2026-10-01');
  assert.equal(utcFirstOfMonth(Math.floor(Date.UTC(2026, 9, 31, 23, 59) / 1000)), '2026-10-01');
  assert.equal(utcFirstOfMonth(Math.floor(Date.UTC(2027, 0, 1, 0, 0) / 1000)), '2027-01-01');
});

// ════════════════════════════════════════════════════════════════════════════
// (b) the two price-id shapes the installed SDK defines
// ════════════════════════════════════════════════════════════════════════════
test('(b) a price id is read through the shape each SDK type actually has', () => {
  assert.equal(invoiceLinePriceId(invoiceLine(WORKER) as any), WORKER);
  assert.equal(invoiceLinePriceId(invoiceLine(null) as any), null);
  assert.equal(sessionLinePriceId(sessionLine(QUEENS) as any), QUEENS);
  assert.equal(sessionLinePriceId(sessionLine(null) as any), null);
});

// ════════════════════════════════════════════════════════════════════════════
// (c) the first delivery accrues: two levels, integer cents, one rpc
// ════════════════════════════════════════════════════════════════════════════
test('(c) invoice.payment_succeeded accrues L1 20% and L2 10% in integer cents, in one rpc', async () => {
  const db = seed();
  const stripe = new FakeStripe({ invoice: fakeInvoice({ amountPaid: 1000, priceIds: [WORKER] }) });
  const res = await deliver(db, stripe, invoiceEvent({ amountPaid: 1000, priceIds: [WORKER] }));

  assert.equal(res.status, 200);
  assert.equal(db.countRpc(), 1);
  const args: any = db.lastAccrual();
  assert.equal(args.p_invoice_ref, 'in_test_1');
  assert.equal(args.p_source_agent, 'ag_src');
  assert.equal(args.p_source_cents, 1000);
  assert.equal(args.p_period_month, '2026-10-01');
  assert.equal(args.p_livemode, false);
  assert.deepEqual(args.p_rows, [
    { earning_agent_id: 'ag_one', level: 1, rate_bps: 2000, amount_cents: 200 },
    { earning_agent_id: 'ag_two', level: 2, rate_bps: 1000, amount_cents: 100 },
  ]);
  // R11 · nothing above level 2, however long the chain is.
  assert.equal(args.p_rows.length, 2);
  // The amount came from the RETRIEVED invoice (R6), so the retrieve happened.
  assert.deepEqual(stripe.retrieveCalls, ['invoice:in_test_1']);
  assert.equal(db.failures().length, 0);
});

// ════════════════════════════════════════════════════════════════════════════
// (d) replay of the same event: 200 already_processed, nothing written
// ════════════════════════════════════════════════════════════════════════════
test('(d) a replayed event answers 200 already_processed and writes nothing', async () => {
  const db = seed();
  const stripe = new FakeStripe({ invoice: fakeInvoice({ amountPaid: 1000, priceIds: [WORKER] }) });
  const event = invoiceEvent({ amountPaid: 1000, priceIds: [WORKER] });

  const first = await deliver(db, stripe, event);
  const rpcAfterFirst = db.countRpc();
  const second = await deliver(db, stripe, event);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.already_processed, true);
  assert.equal(rpcAfterFirst, 1);
  assert.equal(db.countRpc(), 1, 'the replay must not reach rail_accrue at all');
  assert.equal(stripe.retrieveCalls.length, 1, 'the replay must not even retrieve the invoice');
  assert.equal(db.rows.stripe_events.length, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// (e) two concurrent deliveries: exactly one claim, exactly one rpc
// ════════════════════════════════════════════════════════════════════════════
test('(e) two concurrent deliveries of one event produce exactly one claim and one rpc', async () => {
  const db = seed();
  const stripe = new FakeStripe({ invoice: fakeInvoice({ amountPaid: 7900, priceIds: [HONEY] }) });
  const event = invoiceEvent({ amountPaid: 7900, priceIds: [HONEY] });

  const [a, b] = await Promise.all([deliver(db, stripe, event), deliver(db, stripe, event)]);

  const duplicates = [a, b].filter((r) => r.body.already_processed === true);
  assert.equal(duplicates.length, 1, 'exactly one delivery must lose the claim');
  assert.equal(db.rows.stripe_events.length, 1);
  assert.equal(db.countRpc(), 1, 'exactly one accrual write');
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
});

// ════════════════════════════════════════════════════════════════════════════
// (f) the second invoice event type, same invoice: claimed once, no double accrual
// ════════════════════════════════════════════════════════════════════════════
test('(f) invoice_payment.paid resolves the same invoice and the second event writes nothing', async () => {
  const db = seed();
  const invoice = fakeInvoice({ amountPaid: 1000, priceIds: [WORKER] });
  const stripe = new FakeStripe({ invoice });

  const succeeded = await deliver(db, stripe, invoiceEvent({ amountPaid: 1000, priceIds: [WORKER] },
    { id: 'evt_succeeded' }));
  // A DIFFERENT event id — Stripe sends both types — carrying only a reference.
  const paid = await deliver(db, stripe, fakeEvent(
    'invoice_payment.paid',
    { id: 'inpay_1', invoice: 'in_test_1' },
    { id: 'evt_paid' },
  ));

  assert.equal(succeeded.status, 200);
  assert.equal(paid.status, 200);
  assert.equal(db.rows.stripe_events.length, 2, 'two events, both claimed');
  assert.equal(db.countRpc(), 2, 'both reach rail_accrue — the index is what refuses the second');
  // The invoice ref is identical, which is what makes the second a no-op in the DB.
  assert.deepEqual(db.rpcCalls.map((c) => c.args.p_invoice_ref), ['in_test_1', 'in_test_1']);
  assert.equal(db.accrued.size, 1, 'one invoice claimed once');
});

// ════════════════════════════════════════════════════════════════════════════
// (g) R10 · amount 0
// ════════════════════════════════════════════════════════════════════════════
test('(g) a paid invoice with amount 0 writes nothing (trial, 100%-off voucher)', async () => {
  const db = seed();
  const stripe = new FakeStripe({ invoice: fakeInvoice({ amountPaid: 0, priceIds: [WORKER] }) });
  const res = await deliver(db, stripe, invoiceEvent({ amountPaid: 0, priceIds: [WORKER] }));

  assert.equal(res.status, 200);
  assert.equal(db.countRpc(), 0);
  assert.equal(db.failures().length, 0, 'zero is not a fault and needs no row');
});

// ════════════════════════════════════════════════════════════════════════════
// (h) R47 · a price that is not in the catalog
// ════════════════════════════════════════════════════════════════════════════
test('(h) a non-catalog price accrues nothing and records non_membership_payment', async () => {
  const db = seed();
  const stripe = new FakeStripe({ invoice: fakeInvoice({ amountPaid: 4900, priceIds: ['price_some_bounty'] }) });
  const res = await deliver(db, stripe, invoiceEvent({ amountPaid: 4900, priceIds: ['price_some_bounty'] }));

  assert.equal(res.status, 200);
  assert.equal(db.countRpc(), 0);
  const rows = db.failures('non_membership_payment');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_id, 'evt_test_1');
  assert.deepEqual(rows[0].detail.price_ids, ['price_some_bounty']);
});

test('(h2) a mixed cart — one membership line and one unpriced line — accrues nothing', async () => {
  const db = seed();
  const inv = fakeInvoice({ amountPaid: 1000, priceIds: [WORKER, null] });
  const stripe = new FakeStripe({ invoice: inv });
  const res = await deliver(db, stripe, fakeEvent('invoice.payment_succeeded', inv));

  assert.equal(res.status, 200);
  assert.equal(db.countRpc(), 0);
  assert.equal(db.failures('non_membership_payment').length, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// (i) R59 · the rail_accrue error is never swallowed
// ════════════════════════════════════════════════════════════════════════════
test('(i) a rail_accrue error answers 500 and releases the claim so Stripe retries', async () => {
  const db = seed();
  db.rpcError = { code: '42883', message: 'function rail_accrue(unknown) does not exist' };
  const stripe = new FakeStripe({ invoice: fakeInvoice({ amountPaid: 1000, priceIds: [WORKER] }) });

  const res = await deliver(db, stripe, invoiceEvent({ amountPaid: 1000, priceIds: [WORKER] }));

  assert.equal(res.status, 500, 'the 500 IS the retry signal in the R59 deploy gap');
  assert.equal(res.body.error, 'webhook failed after claim');
  assert.equal(db.rows.stripe_events.length, 0, 'claim released (R14)');
  assert.equal(db.failures('claim_release_failed').length, 0);

  // And the retry succeeds once the function exists.
  db.rpcError = null;
  const retry = await deliver(db, stripe, invoiceEvent({ amountPaid: 1000, priceIds: [WORKER] }));
  assert.equal(retry.status, 200);
  assert.equal(db.countRpc(), 2);
  assert.equal(db.accrued.size, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// (j) R6/R14 · the retrieve itself fails
// ════════════════════════════════════════════════════════════════════════════
test('(j) a failing invoices.retrieve answers 500 and releases the claim', async () => {
  const db = seed();
  const stripe = new FakeStripe({ retrieveError: 'connection reset by peer' });
  const res = await deliver(db, stripe, invoiceEvent({ amountPaid: 1000, priceIds: [WORKER] }));

  assert.equal(res.status, 500);
  assert.equal(db.rows.stripe_events.length, 0);
  assert.equal(db.countRpc(), 0);
});

// ════════════════════════════════════════════════════════════════════════════
// (k) R14's second branch · the release fails too
// ════════════════════════════════════════════════════════════════════════════
test('(k) when the claim cannot be released, a claim_release_failed row is written and it is still 500', async () => {
  const db = seed();
  db.rpcError = { message: 'deadlock detected' };
  db.releaseError = { code: '42P01', message: 'relation "stripe_events" does not exist' };
  const stripe = new FakeStripe({ invoice: fakeInvoice({ amountPaid: 1000, priceIds: [WORKER] }) });

  const res = await deliver(db, stripe, invoiceEvent({ amountPaid: 1000, priceIds: [WORKER] }));

  assert.equal(res.status, 500);
  const rows = db.failures('claim_release_failed');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_type, 'invoice.payment_succeeded');
  assert.equal(db.rows.stripe_events.length, 1, 'the claim stays; only a human moves it now');
});

// ════════════════════════════════════════════════════════════════════════════
// (l)(m) H3 · the 30-minute member race
// ════════════════════════════════════════════════════════════════════════════
test('(l) no member 5 minutes after the event: 500 and the claim is released (assume the race)', async () => {
  const db = seed();
  db.rows.members = []; // checkout has not landed yet
  const stripe = new FakeStripe({ invoice: fakeInvoice({ amountPaid: 1000, priceIds: [WORKER] }) });

  const res = await deliver(db, stripe,
    invoiceEvent({ amountPaid: 1000, priceIds: [WORKER] }, { ageSeconds: 5 * 60 }));

  assert.equal(res.status, 500);
  assert.equal(db.rows.stripe_events.length, 0, 'released, so Stripe\'s retry is processed');
  assert.equal(db.countRpc(), 0);
  assert.equal(db.failures('member_not_found').length, 0, 'not quarantined — it is still a race');
});

test('(m) no member 2 hours after the event: 200 quarantined with a member_not_found row', async () => {
  const db = seed();
  db.rows.members = [];
  const stripe = new FakeStripe({ invoice: fakeInvoice({ amountPaid: 1000, priceIds: [WORKER] }) });

  const res = await deliver(db, stripe,
    invoiceEvent({ amountPaid: 1000, priceIds: [WORKER] }, { ageSeconds: 2 * 60 * 60 }));

  assert.equal(res.status, 200);
  assert.equal(res.body.quarantined, true);
  assert.equal(db.rows.stripe_events.length, 1, 'claim kept: a retry cannot conjure a member');
  const rows = db.failures('member_not_found');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].detail.customer, 'cus_test_1');
  assert.ok(rows[0].detail.age_ms >= 2 * 60 * 60 * 1000);
});

// ════════════════════════════════════════════════════════════════════════════
// (n) R3/R4 · the floor, at all three tier amounts
// ════════════════════════════════════════════════════════════════════════════
test('(n) floor(cents × rate_bps / 10000) at every tier amount: 200/100, 1580/790, 4980/2490', async () => {
  const cases: Array<[number, number, number, string]> = [
    [1000, 200, 100, WORKER],
    [7900, 1580, 790, HONEY],
    [24900, 4980, 2490, QUEENS],
  ];
  for (const [cents, l1, l2, price] of cases) {
    const db = seed();
    const mode = price === QUEENS ? 'payment' : 'subscription';
    const outcome = await accrueForSource(
      { stripe: {} as any, db: db as unknown as AccrualDb, now: () => new Date() },
      { ref: `ref_${cents}`, amountCents: cents, periodMonth: '2026-10-01', livemode: false,
        mode, priceIds: [price], sourceAgentId: 'ag_src' },
      async () => [{ agentId: 'ag_one', level: 1 }, { agentId: 'ag_two', level: 2 }],
    );
    assert.equal(outcome.kind, 'written', `${cents} should write`);
    const args: any = db.lastAccrual();
    assert.deepEqual(
      args.p_rows.map((r: any) => r.amount_cents), [l1, l2],
      `${cents} cents must split to ${l1} and ${l2}`,
    );
    // Integers, not floats: 24900 × 0.1 is 2490.0000000000005 in IEEE 754.
    for (const r of args.p_rows) assert.ok(Number.isInteger(r.amount_cents));
  }
});

test('(n2) a repeated p_invoice_ref comes back as a replay, not a second write', async () => {
  const db = seed();
  const call = () => accrueForSource(
    { stripe: {} as any, db: db as unknown as AccrualDb, now: () => new Date() },
    { ref: 'ref_same', amountCents: 1000, periodMonth: '2026-10-01', livemode: false,
      mode: 'subscription', priceIds: [WORKER], sourceAgentId: 'ag_src' },
    async () => [{ agentId: 'ag_one', level: 1 }],
  );
  assert.equal((await call()).kind, 'written');
  assert.equal((await call()).kind, 'replay');
  assert.equal(db.countRpc(), 2);
});

// ════════════════════════════════════════════════════════════════════════════
// (o)(p)(q) §5.9 · cancellation
// ════════════════════════════════════════════════════════════════════════════
for (const status of ['canceled', 'unpaid'] as const) {
  test(`(o/p) customer.subscription.updated status '${status}' cancels members AND agents`, async () => {
    const db = seed();
    const stripe = new FakeStripe();
    const res = await deliver(db, stripe, fakeEvent('customer.subscription.updated', {
      id: 'sub_test_1', status, cancel_at_period_end: false,
    }));

    assert.equal(res.status, 200);
    assert.equal(db.member('cus_test_1')!.status, 'inactive');
    // FIND-WH-1: isActiveEarner reads agents.status, so the write must land there too.
    assert.equal(db.agent('ag_src')!.status, 'inactive');
  });
}

test('(q) cancel_at_period_end alone changes nothing — the member has paid through the period', async () => {
  const db = seed();
  const stripe = new FakeStripe();
  const res = await deliver(db, stripe, fakeEvent('customer.subscription.updated', {
    id: 'sub_test_1', status: 'active', cancel_at_period_end: true,
  }));

  assert.equal(res.status, 200);
  assert.equal(db.member('cus_test_1')!.status, 'active');
  assert.equal(db.agent('ag_src')!.status, 'active');
  assert.equal(db.calls.filter((c) => c.table === 'members' && c.op === 'update').length, 0);
});

test('(q2) customer.subscription.deleted cancels, and a members error answers 500 with the claim released', async () => {
  const db = seed();
  const stripe = new FakeStripe();
  const ok = await deliver(db, stripe, fakeEvent('customer.subscription.deleted',
    { id: 'sub_test_1', status: 'canceled' }, { id: 'evt_del_1' }));
  assert.equal(ok.status, 200);
  assert.equal(db.agent('ag_src')!.status, 'inactive');

  const db2 = seed();
  db2.writeError = { table: 'members', error: { message: 'could not serialize access' } };
  const bad = await deliver(db2, stripe, fakeEvent('customer.subscription.deleted',
    { id: 'sub_test_1', status: 'canceled' }, { id: 'evt_del_2' }));
  assert.equal(bad.status, 500, 'a silent miss would leave a cancelled bee earning');
  // M-1 · the 500 goes out through failAfterClaim, so it reads like every other
  // post-claim failure rather than announcing the stage to Stripe.
  assert.equal(bad.body.error, 'webhook failed after claim');
  assert.equal(db2.rows.stripe_events.length, 0,
    'claim released so Stripe retries the cancellation');
});

test('(q3) M-1 · an agents-stage error also releases the claim, not just the members stage', async () => {
  const db2 = seed();
  const stripe = new FakeStripe();
  // The members update succeeds and hands back the agent ids; the agents update is
  // the one that fails. This is the worse half of the bug: members already reads
  // 'inactive' while agents.status is still 'active', and isActiveEarner reads
  // agents — so a lost retry here leaves a cancelled bee earning.
  db2.writeError = { table: 'agents', error: { code: '40001', message: 'serialization failure' } };

  const bad = await deliver(db2, stripe, fakeEvent('customer.subscription.deleted',
    { id: 'sub_test_1', status: 'canceled' }, { id: 'evt_del_3' }));

  assert.equal(bad.status, 500);
  assert.equal(bad.body.error, 'webhook failed after claim');
  assert.equal(db2.rows.stripe_events.length, 0,
    'claim released so Stripe retries the cancellation');
  assert.equal(db2.failures('claim_release_failed').length, 0, 'the release itself worked');
  // The half-applied state the retry has to finish: members moved, agents did not.
  assert.equal(db2.member('cus_test_1')!.status, 'inactive');
  assert.equal(db2.agent('ag_src')!.status, 'active');
});

test('(q4) M-1 · the same release happens on customer.subscription.updated -> canceled', async () => {
  const db2 = seed();
  db2.writeError = { table: 'agents', error: { message: 'deadlock detected' } };
  const bad = await deliver(db2, new FakeStripe(), fakeEvent('customer.subscription.updated',
    { id: 'sub_test_1', status: 'canceled', cancel_at_period_end: false }, { id: 'evt_upd_fail' }));

  assert.equal(bad.status, 500);
  assert.equal(bad.body.error, 'webhook failed after claim');
  assert.equal(db2.rows.stripe_events.length, 0,
    'claim released so Stripe retries the cancellation');
});

// ════════════════════════════════════════════════════════════════════════════
// (r) R15 · invoice.payment_failed, and its error
// ════════════════════════════════════════════════════════════════════════════
test('(r) invoice.payment_failed marks the member, and a failed write answers 500', async () => {
  const db = seed();
  const stripe = new FakeStripe();
  const res = await deliver(db, stripe, fakeEvent('invoice.payment_failed',
    { id: 'in_failed_1', customer: 'cus_test_1' }, { id: 'evt_fail_1' }));
  assert.equal(res.status, 200);
  assert.equal(db.member('cus_test_1')!.status, 'payment_failed');

  const db2 = seed();
  db2.writeError = { table: 'members', error: { code: '40001', message: 'serialization failure' } };
  const bad = await deliver(db2, stripe, fakeEvent('invoice.payment_failed',
    { id: 'in_failed_1', customer: 'cus_test_1' }, { id: 'evt_fail_2' }));
  assert.equal(bad.status, 500, 'the discarded error (R15) is now checked');
  assert.equal(db2.rows.stripe_events.length, 0, 'claim released');
});

// ════════════════════════════════════════════════════════════════════════════
// (s) an invoice with no customer
// ════════════════════════════════════════════════════════════════════════════
test('(s) an invoice with no customer is quarantined 200, not accrued', async () => {
  const db = seed();
  const inv = fakeInvoice({ amountPaid: 1000, customer: null, priceIds: [WORKER] });
  const stripe = new FakeStripe({ invoice: inv });
  const res = await deliver(db, stripe, fakeEvent('invoice.payment_succeeded', inv));

  assert.equal(res.status, 200);
  assert.equal(res.body.quarantined, true);
  assert.equal(db.countRpc(), 0);
  assert.equal(db.failures('invoice_without_customer').length, 1);
});

test('(s2) an invoice event with no invoice id is quarantined 200', async () => {
  const db = seed();
  const stripe = new FakeStripe();
  const res = await deliver(db, stripe, fakeEvent('invoice_payment.paid', { id: 'inpay_x', invoice: null }));

  assert.equal(res.status, 200);
  assert.equal(res.body.quarantined, true);
  assert.equal(stripe.retrieveCalls.length, 0);
  assert.equal(db.failures('invoice_id_missing').length, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// (t) §5.5 · the one-time payment, on the payment intent ref
// ════════════════════════════════════════════════════════════════════════════
test('(t) a one-time checkout accrues on the payment intent, with that intent\'s UTC month', async () => {
  const db = seed();
  const stripe = new FakeStripe({
    paymentIntent: {
      id: 'pi_queens_1', livemode: false,
      // amount_received and customer live on the INTENT since F2; this fixture
      // carries them because that is now where resolveOneTime reads the money.
      amount_received: 24900, customer: 'cus_test_1',
      created: Math.floor(Date.UTC(2026, 9, 1, 0, 15) / 1000),
    },
    sessionLineItems: [sessionLine(QUEENS)],
  });
  const session = {
    id: 'cs_queens_1', mode: 'payment', amount_total: 24900,
    customer: 'cus_test_1', customer_email: 'src@example.test',
    payment_intent: 'pi_queens_1', subscription: null,
    metadata: { tier: 'queens', agentName: 'Source', soul: 'The Operator', agent_id: 'ag_src' },
  };

  const res = await deliver(db, stripe, fakeEvent('checkout.session.completed', session));

  assert.equal(res.status, 200);
  assert.equal(db.countRpc(), 1);
  const args: any = db.lastAccrual();
  assert.equal(args.p_invoice_ref, 'pi_queens_1', 'the ref is the payment intent, not the session');
  assert.equal(args.p_period_month, '2026-10-01');
  assert.deepEqual(args.p_rows.map((r: any) => r.amount_cents), [4980, 2490]);
  // The tier word was translated once, at the boundary.
  assert.equal(db.member('cus_test_1')!.tier, 'queens_council');
});

test('(t2) an unrecognised metadata.tier is quarantined 200 and writes no member', async () => {
  const db = seed();
  db.rows.members = [];
  const stripe = new FakeStripe();
  const res = await deliver(db, stripe, fakeEvent('checkout.session.completed', {
    id: 'cs_bad_1', mode: 'subscription', customer: 'cus_new', customer_email: 'new@example.test',
    metadata: { tier: 'platinum' },
  }));

  assert.equal(res.status, 200);
  assert.equal(res.body.quarantined, true);
  assert.equal(db.rows.members.length, 0);
  assert.equal(db.countRpc(), 0);
  assert.equal(db.failures('unrecognised_tier').length, 1);
});

// ════════════════════════════════════════════════════════════════════════════
// (u) the claim cannot be made at all
// ════════════════════════════════════════════════════════════════════════════
test('(u) an unavailable claim fails closed: 500, a claim_failed row, and no work done', async () => {
  const db = seed();
  db.writeError = { table: 'stripe_events', error: { code: '42P01', message: 'relation "stripe_events" does not exist' } };
  const stripe = new FakeStripe({ invoice: fakeInvoice({ amountPaid: 1000, priceIds: [WORKER] }) });

  const res = await deliver(db, stripe, invoiceEvent({ amountPaid: 1000, priceIds: [WORKER] }));

  assert.equal(res.status, 500);
  assert.equal(db.countRpc(), 0, 'failing open would double-pay');
  assert.equal(stripe.retrieveCalls.length, 0);
});

// ════════════════════════════════════════════════════════════════════════════
// (v) F1 · the invoice retrieve passes NO options
// ════════════════════════════════════════════════════════════════════════════
test('(v) invoices.retrieve is called with the id alone — no second argument', async () => {
  const db = seed();
  const stripe = new FakeStripe({ invoice: fakeInvoice({ amountPaid: 1000, priceIds: [WORKER] }) });
  const res = await deliver(db, stripe, invoiceEvent({ amountPaid: 1000, priceIds: [WORKER] }));

  assert.equal(res.status, 200);
  assert.equal(stripe.retrieveArgs.length, 1);
  assert.equal(stripe.retrieveArgs[0].call, 'invoice:in_test_1');
  assert.equal(stripe.retrieveArgs[0].params, undefined,
    'no options object at all — the price id is already a string in the plain response');
  // And it still read the price id, so dropping the options cost nothing.
  const args: any = db.lastAccrual();
  assert.deepEqual(args.p_rows.map((r: any) => r.amount_cents), [200, 100]);
});

test('(v2) the payment intent retrieve passes no options either', async () => {
  const stripe = new FakeStripe({
    paymentIntent: {
      id: 'pi_1', livemode: false, amount_received: 24900, customer: 'cus_test_1',
      created: Math.floor(Date.UTC(2026, 9, 1, 0, 15) / 1000),
    },
    sessionLineItems: [sessionLine(QUEENS)],
  });
  await resolveOneTime(stripe as any, { id: 'cs_1', payment_intent: 'pi_1' } as any);
  const pi = stripe.retrieveArgs.find((a) => a.call === 'pi:pi_1');
  assert.ok(pi);
  assert.equal(pi!.params, undefined);
});

// ════════════════════════════════════════════════════════════════════════════
// (w) F2 · every money field of a one-time payment comes from the INTENT
// ════════════════════════════════════════════════════════════════════════════
test('(w) a one-time payment uses the intent\'s amount_received and ignores session.amount_total', async () => {
  const db = seed();
  const stripe = new FakeStripe({
    paymentIntent: {
      id: 'pi_queens_2', livemode: false,
      amount_received: 24900,            // what Stripe actually took
      customer: 'cus_from_intent',
      created: Math.floor(Date.UTC(2026, 9, 1, 0, 15) / 1000),
    },
    sessionLineItems: [sessionLine(QUEENS)],
  });
  const session = {
    id: 'cs_queens_2', mode: 'payment',
    amount_total: 999900,                // deliberately wrong, and on the payload
    customer: 'cus_test_1', customer_email: 'src@example.test',
    payment_intent: 'pi_queens_2', subscription: null,
    metadata: { tier: 'queens', agentName: 'Source', soul: 'The Operator', agent_id: 'ag_src' },
  };

  const res = await deliver(db, stripe, fakeEvent('checkout.session.completed', session));
  assert.equal(res.status, 200);

  const args: any = db.lastAccrual();
  assert.equal(args.p_source_cents, 24900, 'the intent won, not the payload');
  assert.notEqual(args.p_source_cents, 999900);
  assert.deepEqual(args.p_rows.map((r: any) => r.amount_cents), [4980, 2490]);

  // And the customer id too: the intent's, not the session's.
  const resolved = await resolveOneTime(stripe as any, session as any);
  assert.equal(resolved.customerId, 'cus_from_intent');
  assert.equal(resolved.amountCents, 24900);
  assert.equal(resolved.ref, 'pi_queens_2');
  assert.equal(resolved.periodMonth, '2026-10-01');
});

// ════════════════════════════════════════════════════════════════════════════
// (x) F3 · the welcome is posted once, however many times the handler re-runs
// ════════════════════════════════════════════════════════════════════════════
test('(x) a second checkout.session.completed for the same bee inserts zero further messages', async () => {
  const db = seed();
  // The life coach for 'The Operator'. Without this row postWelcome returns early
  // and the test would pass without proving anything.
  db.rows.agents.push({ id: 'ag_atlas', name: 'ATLAS', referral_code: 'ATLAS', status: 'active' });
  const stripe = new FakeStripe();
  const session = {
    id: 'cs_welcome_1', mode: 'subscription', customer: 'cus_test_1',
    customer_email: 'src@example.test', subscription: 'sub_test_1',
    metadata: { tier: 'worker', agentName: 'Source', soul: 'The Operator', agent_id: 'ag_src' },
  };

  const first = await deliver(db, stripe, fakeEvent('checkout.session.completed', session,
    { id: 'evt_welcome_1' }));
  assert.equal(first.status, 200);
  assert.equal(db.rows.messages.length, 1, 'the greeting is posted on the first delivery');
  assert.equal(db.rows.honeycombs.length, 1);
  const countAfterFirst = db.rows.honeycombs[0].message_count;

  // Stripe re-runs the whole handler after any 500 raised later in the branch.
  const second = await deliver(db, stripe, fakeEvent('checkout.session.completed', session,
    { id: 'evt_welcome_2' }));
  assert.equal(second.status, 200);
  assert.equal(db.rows.messages.length, 1, 'no second greeting');
  assert.equal(db.rows.honeycombs.length, 1, 'no second chamber');
  assert.equal(db.rows.honeycombs[0].message_count, countAfterFirst,
    'message_count was not bumped again either');
});

// ════════════════════════════════════════════════════════════════════════════
// (y) F4 · a chain link that is the payer never becomes a row
// ════════════════════════════════════════════════════════════════════════════
test('(y) a self-referencing chain link produces no accrual row (rail_accrue would raise 22023)', async () => {
  const db = seed();
  const outcome = await accrueForSource(
    { stripe: {} as any, db: db as unknown as AccrualDb, now: () => new Date() },
    { ref: 'ref_self_1', amountCents: 1000, periodMonth: '2026-10-01', livemode: false,
      mode: 'subscription', priceIds: [WORKER], sourceAgentId: 'ag_src' },
    async () => [{ agentId: 'ag_src', level: 1 }, { agentId: 'ag_one', level: 2 }],
  );
  assert.equal(outcome.kind, 'written');
  const args: any = db.lastAccrual();
  assert.equal(args.p_rows.length, 1, 'the payer is gone, the real earner stays');
  assert.deepEqual(args.p_rows, [
    { earning_agent_id: 'ag_one', level: 2, rate_bps: 1000, amount_cents: 100 },
  ]);
});

test('(y2) a cycle in referred_by_code accrues nothing but still claims the invoice', async () => {
  const db = seed();
  // ag_src's referrer code is its OWN code: the walk returns the payer at both levels.
  db.rows.agents = db.rows.agents.map((a) =>
    a.id === 'ag_src' ? { ...a, referred_by_code: 'SRC' } : a);
  const stripe = new FakeStripe({ invoice: fakeInvoice({ amountPaid: 1000, priceIds: [WORKER] }) });

  const res = await deliver(db, stripe, invoiceEvent({ amountPaid: 1000, priceIds: [WORKER] }));
  assert.equal(res.status, 200);
  assert.equal(db.countRpc(), 1, 'rail_accrue is still called: the revenue row is the claim');
  const args: any = db.lastAccrual();
  assert.equal(args.p_rows.length, 0);
});

// ════════════════════════════════════════════════════════════════════════════
// (z) F5 · a paginated line list fails closed
// ════════════════════════════════════════════════════════════════════════════
test('(z) has_more on the invoice lines yields non_membership, a failures row and no rpc', async () => {
  const db = seed();
  const inv = fakeInvoice({ amountPaid: 1000, priceIds: [WORKER], linesHasMore: true });
  const stripe = new FakeStripe({ invoice: inv });

  const res = await deliver(db, stripe, fakeEvent('invoice.payment_succeeded', inv));

  assert.equal(res.status, 200);
  assert.equal(db.countRpc(), 0, 'a partial read of the lines must not accrue');
  const rows = db.failures('non_membership_payment');
  assert.equal(rows.length, 1);
  // The null is the recorded evidence that a page was missing.
  assert.deepEqual(rows[0].detail.price_ids, [WORKER, null]);

  // And the same invoice without has_more does accrue, so the flag is what refused it.
  const db2 = seed();
  const ok = fakeInvoice({ amountPaid: 1000, priceIds: [WORKER] });
  const res2 = await deliver(db2, new FakeStripe({ invoice: ok }),
    fakeEvent('invoice.payment_succeeded', ok, { id: 'evt_haspage_2' }));
  assert.equal(res2.status, 200);
  assert.equal(db2.countRpc(), 1);
});

// ════════════════════════════════════════════════════════════════════════════
// (aa) F6 · the 30-minute window is read from the injected clock
// ════════════════════════════════════════════════════════════════════════════
test('(aa) the member-race window uses deps.now(), not the process clock', async () => {
  const db = seed();
  db.rows.members = [];
  const stripe = new FakeStripe({ invoice: fakeInvoice({ amountPaid: 1000, priceIds: [WORKER] }) });
  // The event was created SECONDS ago by the real clock. Only the injected clock,
  // three hours ahead, can put it outside the window.
  const event = invoiceEvent({ amountPaid: 1000, priceIds: [WORKER] }, { ageSeconds: 10 });
  const threeHoursOn = () => new Date(Date.now() + 3 * 60 * 60 * 1000);

  const res = await deliver(db, stripe, event, threeHoursOn);

  assert.equal(res.status, 200, 'outside the window: quarantine, not a retry');
  assert.equal(res.body.quarantined, true);
  const rows = db.failures('member_not_found');
  assert.equal(rows.length, 1);
  assert.ok(rows[0].detail.age_ms > 2 * 60 * 60 * 1000);

  // The same event on the real clock is inside the window and is retried instead.
  const db2 = seed();
  db2.rows.members = [];
  const inside = await deliver(db2, stripe,
    invoiceEvent({ amountPaid: 1000, priceIds: [WORKER] }, { ageSeconds: 10 }));
  assert.equal(inside.status, 500);
  assert.equal(db2.failures('member_not_found').length, 0);
});

// ════════════════════════════════════════════════════════════════════════════
// NIK-RAIL-005 · §6 reversal. Ids (bb) onward, per the ticket.
//
// Every one of these drives the REAL claimEvent + handleStripeEvent through
// deliver(), exactly as (a)-(aa) do. The accrual they reverse is created by a REAL
// invoice delivery first, so the ref under test is the ref the rail actually wrote —
// not a value the test chose.
// ════════════════════════════════════════════════════════════════════════════

/** Accrue on one subscription invoice through the real pipeline. Returns the db. */
async function seedAccrued(ref = 'in_test_1', cents = 1000) {
  const db = seed();
  const inv = fakeInvoice({ id: ref, amountPaid: cents, priceIds: [WORKER] });
  const res = await deliver(db, new FakeStripe({ invoice: inv }),
    fakeEvent('invoice.payment_succeeded', inv, { id: `evt_accrue_${ref}` }));
  assert.equal(res.status, 200);
  assert.equal(db.rows.referral_earnings.length, 2, 'two pending accruals to reverse');
  return db;
}

// ════════════════════════════════════════════════════════════════════════════
// (bb) a refund on a SUBSCRIPTION charge: the list resolves the invoice ref
// ════════════════════════════════════════════════════════════════════════════
test('(bb) charge.refunded on a subscription resolves the invoice ref and reverses it', async () => {
  const db = await seedAccrued('in_test_1');
  const stripe = new FakeStripe({ invoicePayments: [fakeInvoicePayment('in_test_1')] });

  const res = await deliver(db, stripe, fakeEvent('charge.refunded',
    fakeCharge({ paymentIntent: 'pi_sub_1' }), { id: 'evt_refund_1' }));

  assert.equal(res.status, 200);
  assert.equal(res.body.reversed, 2);
  // ONE rpc call, with the ref the list returned and the reason 'refund'.
  assert.equal(db.countRpc('rail_reverse'), 1);
  const args: any = db.rpcCalls.find((c) => c.fn === 'rail_reverse')!.args;
  assert.equal(args.p_invoice_ref, 'in_test_1');
  assert.equal(args.p_reason, 'refund');
  assert.equal(args.p_livemode, false);
  // the rows themselves
  assert.equal(db.rows.referral_earnings.filter((r) => r.status === 'reversed').length, 2);
  assert.equal(db.rows.referral_earnings.filter((r) => r.reversed_at === null).length, 0);
  assert.deepEqual(Array.from(new Set(db.rows.referral_earnings.map((r) => r.reversal_reason))), ['refund']);
  // the lookup was made with the shape the pinned SDK requires
  assert.equal(stripe.invoicePaymentsCalls.length, 1);
  assert.deepEqual(stripe.invoicePaymentsCalls[0], {
    payment: { type: 'payment_intent', payment_intent: 'pi_sub_1' },
    limit: 1,
  });
  assert.equal(db.failures().length, 0, 'a clean reversal records no failure row');
});

// ════════════════════════════════════════════════════════════════════════════
// (cc) a refund on a ONE-TIME payment: no invoice, so the intent IS the ref
// ════════════════════════════════════════════════════════════════════════════
test('(cc) charge.refunded on a one-time payment reverses against the payment intent', async () => {
  const db = seed();
  // Accrue the one-time way: the ref is the payment intent (§5.5).
  const stripeAccrue = new FakeStripe({
    paymentIntent: {
      id: 'pi_queens_9', livemode: false, amount_received: 24900, customer: 'cus_test_1',
      created: Math.floor(Date.UTC(2026, 9, 1, 0, 15) / 1000),
    },
    sessionLineItems: [sessionLine(QUEENS)],
  });
  const accrued = await deliver(db, stripeAccrue, fakeEvent('checkout.session.completed', {
    id: 'cs_q_9', mode: 'payment', amount_total: 24900, customer: 'cus_test_1',
    customer_email: 'src@example.test', payment_intent: 'pi_queens_9', subscription: null,
    metadata: { tier: 'queens', agentName: 'Source', soul: 'The Operator', agent_id: 'ag_src' },
  }, { id: 'evt_q_9' }));
  assert.equal(accrued.status, 200);
  assert.equal(db.rows.referral_earnings.length, 2);

  // The refund: the list finds NOTHING, which is the one-time case, not a failure.
  const stripe = new FakeStripe({ invoicePayments: [] });
  const res = await deliver(db, stripe, fakeEvent('charge.refunded',
    fakeCharge({ paymentIntent: 'pi_queens_9', amount: 24900, amountRefunded: 24900 }),
    { id: 'evt_refund_q' }));

  assert.equal(res.status, 200);
  assert.equal(res.body.reversed, 2);
  const args: any = db.rpcCalls.find((c) => c.fn === 'rail_reverse')!.args;
  assert.equal(args.p_invoice_ref, 'pi_queens_9', 'the intent id is the ref (§5.5)');
  assert.equal(db.failures().length, 0);
});

// ════════════════════════════════════════════════════════════════════════════
// (dd) a PARTIAL refund reverses in full, and the second one is idempotent
// ════════════════════════════════════════════════════════════════════════════
test('(dd) a partial refund reverses the invoice in full, and a second partial writes nothing', async () => {
  const db = await seedAccrued('in_part_1');
  const stripe = new FakeStripe({ invoicePayments: [fakeInvoicePayment('in_part_1')] });

  // ruling R-C: ANY refund reverses that invoice's unpaid accruals in full, so a
  // partial refund (amount_refunded < amount, refunded=false) takes the same path.
  const first = await deliver(db, stripe, fakeEvent('charge.refunded',
    fakeCharge({ paymentIntent: 'pi_part_1', amount: 1000, amountRefunded: 400, refunded: false }),
    { id: 'evt_part_1' }));
  assert.equal(first.status, 200);
  assert.equal(first.body.reversed, 2, 'a partial refund still reverses both rows');

  // Stripe fires the event again for the second partial refund.
  const second = await deliver(db, stripe, fakeEvent('charge.refunded',
    fakeCharge({ paymentIntent: 'pi_part_1', amount: 1000, amountRefunded: 1000, refunded: true }),
    { id: 'evt_part_2' }));
  assert.equal(second.status, 200);
  assert.equal(second.body.reversed, 0, 'nothing left to reverse — (true, 0, 0)');
  assert.equal(db.countRpc('rail_reverse'), 2, 'both events called the function');
  assert.equal(db.failures().length, 0, 'an idempotent repeat is not a failure');
  assert.equal(db.rows.referral_earnings.filter((r) => r.status === 'reversed').length, 2);
});

// ════════════════════════════════════════════════════════════════════════════
// (ee) a refund AFTER a payout: recorded, alerted, and nothing clawed back
// ════════════════════════════════════════════════════════════════════════════
test('(ee) a refund after payout records refund_after_payout, alerts, and touches no paid row', async () => {
  const db = await seedAccrued('in_paid_1');
  // The level-1 row has left in a payout; the level-2 row is still pending.
  db.rows.referral_earnings[0].status = 'in_transit';
  const stripe = new FakeStripe({ invoicePayments: [fakeInvoicePayment('in_paid_1')] });
  process.env.HIVE_ALERT_EMAIL = 'ops@example.test'; // this branch DOES alert

  try {
    const res = await deliver(db, stripe, fakeEvent('charge.refunded',
      fakeCharge({ paymentIntent: 'pi_paid_1' }), { id: 'evt_refund_paid' }));

    assert.equal(res.status, 200);
    assert.equal(res.body.reversed, 1);
    assert.equal(res.body.untouched, 1);
    const rows = db.failures('refund_after_payout');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].detail.ref, 'in_paid_1');
    assert.equal(rows[0].detail.reversed, 1);
    assert.equal(rows[0].detail.untouched, 1);
    // R34 · the in_transit row is EXACTLY as it was: no reversal, no negative amount.
    const gone = db.rows.referral_earnings.find((r) => r.status === 'in_transit')!;
    assert.equal(gone.reversed_at, null);
    assert.equal(gone.reversal_reason, null);
  } finally {
    delete process.env.HIVE_ALERT_EMAIL;
  }
});

// ════════════════════════════════════════════════════════════════════════════
// (ff) a ref the rail never saw: a row, NO alert
// ════════════════════════════════════════════════════════════════════════════
test('(ff) a refund on an invoice the rail never accrued records reversal_unresolved with no alert', async () => {
  const db = seed(); // nothing accrued at all
  const stripe = new FakeStripe({ invoicePayments: [fakeInvoicePayment('in_pre_rail')] });

  const res = await deliver(db, stripe, fakeEvent('charge.refunded',
    fakeCharge({ paymentIntent: 'pi_pre_rail' }), { id: 'evt_pre_rail' }));

  assert.equal(res.status, 200);
  assert.equal(res.body.known, false);
  assert.equal(db.countRpc('rail_reverse'), 1, 'the function was still asked');
  const rows = db.failures('reversal_unresolved');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].detail.ref, 'in_pre_rail');
  assert.equal(rows[0].detail.charge_id, 'ch_test_1');
  assert.equal(db.rows.referral_earnings.length, 0);
});

// ════════════════════════════════════════════════════════════════════════════
// (gg) a charge with no payment intent: no Stripe call is made at all
// ════════════════════════════════════════════════════════════════════════════
test('(gg) a charge with no payment_intent is unresolved with cause no_payment_intent, and no Stripe call', async () => {
  const db = await seedAccrued('in_nopi_1');
  const stripe = new FakeStripe({ invoicePayments: [fakeInvoicePayment('in_nopi_1')] });

  const res = await deliver(db, stripe, fakeEvent('charge.refunded',
    fakeCharge({ paymentIntent: null }), { id: 'evt_nopi' }));

  assert.equal(res.status, 200);
  assert.equal(res.body.unresolved, 'no_payment_intent');
  assert.equal(stripe.invoicePaymentsCalls.length, 0, 'nothing to look up, so nothing was looked up');
  assert.equal(db.countRpc('rail_reverse'), 0, 'and the function was never called');
  const rows = db.failures('reversal_unresolved');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].detail.cause, 'no_payment_intent');
  // the accruals are untouched
  assert.equal(db.rows.referral_earnings.filter((r) => r.status === 'pending').length, 2);
});

// ════════════════════════════════════════════════════════════════════════════
// (hh) a dispute that carries its own payment intent: no charge fetch
// ════════════════════════════════════════════════════════════════════════════
test('(hh) charge.dispute.created with a payment_intent reverses with reason dispute and fetches no charge', async () => {
  const db = await seedAccrued('in_disp_1');
  const stripe = new FakeStripe({ invoicePayments: [fakeInvoicePayment('in_disp_1')] });

  const res = await deliver(db, stripe, fakeEvent('charge.dispute.created',
    fakeDispute({ paymentIntent: 'pi_disp_1', charge: 'ch_disp_1' }), { id: 'evt_disp_1' }));

  assert.equal(res.status, 200);
  assert.equal(res.body.reversed, 2);
  const args: any = db.rpcCalls.find((c) => c.fn === 'rail_reverse')!.args;
  assert.equal(args.p_reason, 'dispute');
  assert.equal(args.p_invoice_ref, 'in_disp_1');
  assert.equal(stripe.retrieveCalls.filter((c) => c.startsWith('charge:')).length, 0,
    'the dispute named the intent, so no charge retrieve was needed');
  assert.deepEqual(Array.from(new Set(db.rows.referral_earnings.map((r) => r.reversal_reason))), ['dispute']);
});

// ════════════════════════════════════════════════════════════════════════════
// (ii) a dispute with only a charge id: exactly one charge fetch
// ════════════════════════════════════════════════════════════════════════════
test('(ii) a dispute with no payment_intent retrieves the charge once and reverses', async () => {
  const db = await seedAccrued('in_disp_2');
  const stripe = new FakeStripe({
    charge: fakeCharge({ id: 'ch_disp_2', paymentIntent: 'pi_disp_2' }),
    invoicePayments: [fakeInvoicePayment('in_disp_2')],
  });

  const res = await deliver(db, stripe, fakeEvent('charge.dispute.created',
    fakeDispute({ paymentIntent: null, charge: 'ch_disp_2' }), { id: 'evt_disp_2' }));

  assert.equal(res.status, 200);
  assert.equal(res.body.reversed, 2);
  assert.deepEqual(stripe.retrieveCalls.filter((c) => c.startsWith('charge:')), ['charge:ch_disp_2']);
  assert.deepEqual(stripe.invoicePaymentsCalls[0], {
    payment: { type: 'payment_intent', payment_intent: 'pi_disp_2' },
    limit: 1,
  });
});

// ════════════════════════════════════════════════════════════════════════════
// (jj) the Stripe lookup throws: 500, claim released, and the retry works
// ════════════════════════════════════════════════════════════════════════════
test('(jj) a failing invoicePayments.list answers 500, releases the claim, and the retry succeeds', async () => {
  const db = await seedAccrued('in_throw_1');
  const failing = new FakeStripe({ invoicePaymentsError: 'connection reset by peer' });

  const res = await deliver(db, failing, fakeEvent('charge.refunded',
    fakeCharge({ paymentIntent: 'pi_throw_1' }), { id: 'evt_throw_1' }));

  assert.equal(res.status, 500);
  assert.equal(res.body.error, 'webhook failed after claim');
  // THE REFUND event's claim is gone. Not stripe_events.length: seedAccrued delivered
  // a real invoice event first, and ITS claim legitimately stays — the first run of
  // this test asserted 0 and caught that distinction.
  assert.equal(db.rows.stripe_events.some((e) => e.event_id === 'evt_throw_1'), false,
    'the refund event claim is released so Stripe retries');
  assert.equal(db.failures('claim_release_failed').length, 0);
  assert.equal(db.countRpc('rail_reverse'), 0, 'nothing was reversed on a lookup failure');
  assert.equal(db.rows.referral_earnings.filter((r) => r.status === 'pending').length, 2);

  // the retry, once Stripe answers
  const working = new FakeStripe({ invoicePayments: [fakeInvoicePayment('in_throw_1')] });
  const retry = await deliver(db, working, fakeEvent('charge.refunded',
    fakeCharge({ paymentIntent: 'pi_throw_1' }), { id: 'evt_throw_1' }));
  assert.equal(retry.status, 200);
  assert.equal(retry.body.reversed, 2);
});

// ════════════════════════════════════════════════════════════════════════════
// (kk) the rpc errors: the same release-and-500 shape (the R59 deploy gap)
// ════════════════════════════════════════════════════════════════════════════
test('(kk) a rail_reverse error answers 500 and releases the claim, so the deploy gap cannot lose a refund', async () => {
  const db = await seedAccrued('in_gap_1');
  // Exactly what the gap looks like: M1b has not run, the function does not exist.
  db.rpcError = { code: '42883', message: 'function rail_reverse(unknown) does not exist' };
  const stripe = new FakeStripe({ invoicePayments: [fakeInvoicePayment('in_gap_1')] });

  const res = await deliver(db, stripe, fakeEvent('charge.refunded',
    fakeCharge({ paymentIntent: 'pi_gap_1' }), { id: 'evt_gap_1' }));

  assert.equal(res.status, 500);
  assert.equal(res.body.error, 'webhook failed after claim');
  assert.equal(db.rows.stripe_events.some((e) => e.event_id === 'evt_gap_1'), false,
    'the refund event claim is released');
  assert.equal(db.rows.referral_earnings.filter((r) => r.status === 'pending').length, 2);

  // and the retry after the migration lands
  db.rpcError = null;
  const retry = await deliver(db, stripe, fakeEvent('charge.refunded',
    fakeCharge({ paymentIntent: 'pi_gap_1' }), { id: 'evt_gap_1' }));
  assert.equal(retry.status, 200);
  assert.equal(retry.body.reversed, 2);
});

// ════════════════════════════════════════════════════════════════════════════
// (ll) OBS2 from NIK-RAIL-002 · an inactive earner is not in the chain
// ════════════════════════════════════════════════════════════════════════════
test('(ll) OBS2 · an inactive earner keeps its position in the walk but accrues nothing', async () => {
  const db = seed();
  // ag_one (level 1) is cancelled. ag_two stays active at level 2 — the walk is
  // positional, so ag_two is still LEVEL 2 and does not get promoted into the gap.
  db.rows.agents = db.rows.agents.map((a) =>
    a.id === 'ag_one' ? { ...a, status: 'inactive' } : a);
  const inv = fakeInvoice({ id: 'in_obs2', amountPaid: 1000, priceIds: [WORKER] });

  const res = await deliver(db, new FakeStripe({ invoice: inv }),
    fakeEvent('invoice.payment_succeeded', inv, { id: 'evt_obs2' }));

  assert.equal(res.status, 200);
  const args: any = db.lastAccrual();
  assert.equal(args.p_rows.length, 1, 'one row, not two');
  assert.deepEqual(args.p_rows, [
    { earning_agent_id: 'ag_two', level: 2, rate_bps: 1000, amount_cents: 100 },
  ]);
  assert.equal(args.p_rows.some((r: any) => r.earning_agent_id === 'ag_one'), false);
});

// ════════════════════════════════════════════════════════════════════════════
// (mm) OBS3 from NIK-RAIL-002 · is_staff earns regardless; a null tier earns
// ════════════════════════════════════════════════════════════════════════════
test('(mm) OBS3 · is_staff earns whatever its tier and status; a null-tier non-scout earns', async () => {
  const db = seed();
  // ag_one: staff, and every other signal against it — scout tier, inactive status.
  // ag_two: no tier at all, but active. Both must appear.
  db.rows.agents = db.rows.agents.map((a) => {
    if (a.id === 'ag_one') return { ...a, is_staff: true, tier: 'scout', status: 'inactive' };
    if (a.id === 'ag_two') return { ...a, tier: null, status: 'active' };
    return a;
  });
  const inv = fakeInvoice({ id: 'in_obs3', amountPaid: 1000, priceIds: [WORKER] });

  const res = await deliver(db, new FakeStripe({ invoice: inv }),
    fakeEvent('invoice.payment_succeeded', inv, { id: 'evt_obs3' }));

  assert.equal(res.status, 200);
  const args: any = db.lastAccrual();
  assert.deepEqual(args.p_rows, [
    { earning_agent_id: 'ag_one', level: 1, rate_bps: 2000, amount_cents: 200 },
    { earning_agent_id: 'ag_two', level: 2, rate_bps: 1000, amount_cents: 100 },
  ]);

  // and the counter-case, so (mm) is not passing for the wrong reason: a SCOUT that
  // is not staff earns nothing.
  const db2 = seed();
  db2.rows.agents = db2.rows.agents.map((a) =>
    a.id === 'ag_one' ? { ...a, is_staff: false, tier: 'scout' } : a);
  const inv2 = fakeInvoice({ id: 'in_obs3b', amountPaid: 1000, priceIds: [WORKER] });
  await deliver(db2, new FakeStripe({ invoice: inv2 }),
    fakeEvent('invoice.payment_succeeded', inv2, { id: 'evt_obs3b' }));
  const args2: any = db2.lastAccrual();
  assert.equal(args2.p_rows.some((r: any) => r.earning_agent_id === 'ag_one'), false,
    'a non-staff scout does not earn');
});
