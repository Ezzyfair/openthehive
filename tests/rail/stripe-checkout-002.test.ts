// tests/rail/stripe-checkout-002.test.ts
// ----------------------------------------------------------------------------
// THE HIVE — STRIPE-CHECKOUT-002. Runs under the repo's rail test command:
//   npm run test:rail
//
// Two findings closed:
//   FIND-CHECKOUT-CATCH-ECHOES-STRIPE — the checkout route's catch answered 500 with
//     the thrown message. It now logs that message and answers one fixed sentence.
//   FIND-WEBHOOK-METADATA-LEGACY-WINDOW — checkout.session.completed looked the bee
//     up by metadata.agent_id before the email. The bee is now resolved by the
//     checkout email alone.
//
// WHAT IS REAL AND WHAT IS STUBBED:
//   CHECKOUT — REAL: app/api/stripe/checkout/route.ts POST, called with a real
//              Request, exactly as tests/rail/stripe-portal-001.test.ts does it.
//              STUBBED: the railStripe export of the compiled lib/rail/stripe module,
//              replaced for the duration of one call. No real Stripe client is built.
//   WEBHOOK  — REAL: lib/rail/webhook-handler.ts handleStripeEvent. STUBBED: its
//              HandlerDeps (FakeDb, FakeStripe, a clock), as tests/rail/accrual.test.ts
//              does it. A thin recorder around FakeDb.from logs each query's table,
//              its eq filters and its write op, so the order of queries can be read.
//   SOURCE   — the webhook handler is read from the repo (not dist).
//
// No network, no database, no Stripe. The price-id env vars are obvious fakes.
// ----------------------------------------------------------------------------
import './resolver'; // MUST stay first: installs the '@/...' require hook.
import test from 'node:test';
import assert from 'node:assert/strict';

import * as checkoutRoute from '@/app/api/stripe/checkout/route';
import { handleStripeEvent, type HandlerResult } from '../../lib/rail/webhook-handler';
import type { AccrualDb } from '../../lib/rail/accrual';
import { FakeDb, FakeStripe, fakeEvent } from './fakes';

const nodeFs: any = require('node:fs');
const nodePath: any = require('node:path');
const stripeModule: any = require('@/lib/rail/stripe');

const REPO_ROOT: string = nodePath.resolve(__dirname, '..', '..', '..');
const HANDLER_SRC: string = nodeFs.readFileSync(
  nodePath.join(REPO_ROOT, 'lib', 'rail', 'webhook-handler.ts'), 'utf8');

process.env.STRIPE_WORKER_BEE_PRICE_ID = 'price_fake_worker_sc002';
process.env.STRIPE_HONEY_MAKER_PRICE_ID = 'price_fake_honey_sc002';
process.env.STRIPE_QUEENS_COUNCIL_PRICE_ID = 'price_fake_queens_sc002';
delete process.env.HIVE_ALERT_EMAIL; // no alert email leaves this test

const SENTENCE =
  "We couldn't open the secure payment page, so nothing was charged. Please try again in a minute.";
const FAKE_CUSTOMER = 'cus_fake_sc002_leak';
const FAKE_REQUEST = 'req_fake_sc002_leak';
const STRIPE_THROWN = `No such customer: '${FAKE_CUSTOMER}'; request-id ${FAKE_REQUEST}`;

/** Silences console.error for one call and returns what was logged. */
async function captureErrors<T>(fn: () => Promise<T>): Promise<{ result: T; logged: string }> {
  const original = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  try {
    return { result: await fn(), logged: lines.join('\n') };
  } finally {
    console.error = original;
  }
}

// ── checkout ────────────────────────────────────────────────────────────────

async function runCheckout(body: Record<string, unknown>, opts: { throws?: string } = {}) {
  const creates: any[] = [];
  let factory = 0;
  const original = stripeModule.railStripe;
  stripeModule.railStripe = () => {
    factory += 1;
    return {
      checkout: {
        sessions: {
          create: async (params: any) => {
            creates.push(params);
            if (opts.throws) throw new Error(opts.throws);
            return { url: 'https://checkout.stripe.example/c/fake' };
          },
        },
      },
    };
  };
  try {
    const req = new Request('https://example.invalid/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res: Response = await (checkoutRoute.POST as any)(req);
    const text = await res.text();
    return { status: res.status, text, body: JSON.parse(text), creates, factory };
  } finally {
    stripeModule.railStripe = original;
  }
}

const JOIN_BODY = {
  tier: 'worker',
  email: 'payer@example.test',
  agentName: 'Fake Bee',
  soul: 'The Operator',
  memberOfRecord: true,
};

test('checkout 002: Stripe throwing answers 500', async () => {
  const { result: r } = await captureErrors(() => runCheckout(JOIN_BODY, { throws: STRIPE_THROWN }));
  assert.equal(r.status, 500);
  assert.equal(r.creates.length, 1, 'the throw came from the Stripe call itself');
});

test('checkout 002: the 500 body has exactly one key, error, equal to the fixed sentence', async () => {
  const { result: r } = await captureErrors(() => runCheckout(JOIN_BODY, { throws: STRIPE_THROWN }));
  assert.deepEqual(Object.keys(r.body), ['error']);
  assert.equal(r.body.error, SENTENCE);
  assert.ok(!SENTENCE.includes('’'), 'the apostrophe is the plain ASCII one');
});

test('checkout 002: the 500 body carries neither the fake customer id nor the fake request id', async () => {
  const { result: r } = await captureErrors(() => runCheckout(JOIN_BODY, { throws: STRIPE_THROWN }));
  assert.ok(!r.text.includes(FAKE_CUSTOMER));
  assert.ok(!r.text.includes(FAKE_REQUEST));
  assert.ok(!r.text.includes('No such customer'));
});

test('checkout 002: the thrown message reaches console.error under the stripe checkout prefix', async () => {
  const { logged } = await captureErrors(() => runCheckout(JOIN_BODY, { throws: STRIPE_THROWN }));
  assert.ok(logged.includes(STRIPE_THROWN), 'the whole thrown message is logged');
  assert.ok(logged.includes('stripe checkout:'), 'the line can be found by its prefix');
});

test('checkout 002: the member-of-record refusal still answers 400 with its message unchanged', async () => {
  const r = await runCheckout({ ...JOIN_BODY, memberOfRecord: false });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, {
    error: 'Confirm you are 18 or older and the member of record for this agent.',
  });
  assert.equal(r.factory, 0);
  assert.equal(r.creates.length, 0);
});

// ── webhook ─────────────────────────────────────────────────────────────────

interface Query { table: string; eqs: Array<[string, unknown]>; op: string }

/** Wraps db.from so every query's table, eq filters and op are recorded in order. */
function recordQueries(db: FakeDb): Query[] {
  const log: Query[] = [];
  const originalFrom = db.from.bind(db);
  (db as any).from = (table: string) => {
    const api = originalFrom(table);
    const q: Query = { table, eqs: [], op: 'select' };
    log.push(q);
    const wrap = (name: string, mark?: string) => {
      const fn = api[name];
      api[name] = (...args: any[]) => {
        if (mark) q.op = mark;
        if (name === 'eq') q.eqs.push([args[0], args[1]]);
        return fn(...args);
      };
    };
    wrap('eq');
    wrap('insert', 'insert');
    wrap('upsert', 'upsert');
    wrap('update', 'update');
    wrap('delete', 'delete');
    return api;
  };
  return log;
}

const BEE_A = { id: 'ag_a_sc002', name: 'Bee A', email: 'a@example.test', soul: 'The Operator',
  referral_code: 'AAA', status: 'pending', tier: null };
const BEE_B = { id: 'ag_b_sc002', name: 'Bee B', email: 'b@example.test', soul: 'The Operator',
  referral_code: 'BBB', status: 'pending', tier: null };

function seed(): FakeDb {
  const db = new FakeDb();
  db.rows.agents = [{ ...BEE_A }, { ...BEE_B }];
  // The life coach for 'The Operator', so the welcome path runs as it does in production.
  db.rows.agents.push({ id: 'ag_atlas', name: 'ATLAS', referral_code: 'ATLAS', status: 'active' });
  return db;
}

function completed(email: string, metadata: Record<string, unknown>) {
  return fakeEvent('checkout.session.completed', {
    id: 'cs_sc002_1', mode: 'subscription', customer: 'cus_sc002_1',
    customer_email: email, subscription: 'sub_sc002_1', metadata,
  }, { id: 'evt_sc002_1' });
}

async function run(db: FakeDb, event: any): Promise<HandlerResult> {
  return await handleStripeEvent(
    { stripe: new FakeStripe() as any, db: db as unknown as AccrualDb, now: () => new Date() },
    event,
  );
}

const META = { tier: 'worker', agentName: 'Payer', soul: 'The Operator' };

test('webhook 002: metadata names bee A, the email belongs to bee B, the membership attaches to B', async () => {
  const db = seed();
  const res = await run(db, completed(BEE_B.email, { ...META, agent_id: BEE_A.id }));
  assert.equal(res.status, 200);
  assert.equal(db.rows.members.length, 1);
  assert.equal(db.rows.members[0].agent_id, BEE_B.id);
  assert.equal(db.agent(BEE_B.id)!.status, 'first_flight');
  assert.equal(db.agent(BEE_A.id)!.status, 'pending', 'bee A is untouched');
  assert.equal(db.agent(BEE_A.id)!.tier, null);
});

test('webhook 002: no email match and an id in metadata attaches to no bee (before this change: bee A)', async () => {
  const db = seed();
  const res = await run(db, completed('nobody@example.test', { ...META, agent_id: BEE_A.id }));
  assert.equal(res.status, 200);
  assert.equal(db.rows.members.length, 1, 'the paid member row is still written');
  assert.equal(db.rows.members[0].email, 'nobody@example.test');
  assert.equal(db.rows.members[0].agent_id, null);
  assert.equal(db.agent(BEE_A.id)!.status, 'pending', 'bee A is untouched');
  assert.equal(db.rows.honeycombs.length, 0, 'no chamber for any bee');
});

test('webhook 002: no agent_id in metadata behaves as before (same rows, same result)', async () => {
  // Without an id in metadata the old code ran only the email lookup, so its
  // behaviour is the email path below. The same event with a stray id added must
  // now produce the very same writes and result: the id is inert.
  const normalise = (db: FakeDb) => db.calls
    .filter((c) => c.table !== 'stripe_events')
    .map((c) => JSON.stringify(c, (k, v) =>
      (k === 'referral_code' || /_at$/.test(k)) ? '<varies>' : v));

  const plainDb = seed();
  const plain = await run(plainDb, completed(BEE_B.email, { ...META }));
  assert.deepEqual(plain, { status: 200, body: { received: true } });
  const m = plainDb.rows.members[0];
  assert.equal(plainDb.rows.members.length, 1);
  assert.equal(m.email, BEE_B.email);
  assert.equal(m.agent_id, BEE_B.id);
  assert.equal(m.stripe_customer_id, 'cus_sc002_1');
  assert.equal(m.stripe_subscription_id, 'sub_sc002_1');
  assert.equal(m.tier, 'worker_bee');
  assert.equal(m.status, 'first_flight');
  assert.equal(m.tokens_remaining, 100000);
  assert.match(m.referral_code, /^PAYER-[0-9A-F]{8}$/);
  assert.equal(plainDb.agent(BEE_B.id)!.status, 'first_flight');
  assert.equal(plainDb.agent(BEE_B.id)!.tier, 'worker_bee');
  assert.equal(plainDb.rows.honeycombs.length, 1);
  assert.equal(plainDb.rows.messages.length, 1);

  const strayDb = seed();
  const stray = await run(strayDb, completed(BEE_B.email, { ...META, agent_id: BEE_A.id }));
  assert.deepEqual(stray, plain);
  assert.deepEqual(normalise(strayDb), normalise(plainDb));
});

test('webhook 002: no query in the branch filters agents by id before the member write', async () => {
  for (const email of [BEE_B.email, 'nobody@example.test']) {
    const db = seed();
    const log = recordQueries(db);
    await run(db, completed(email, { ...META, agent_id: BEE_A.id }));
    const memberWrite = log.findIndex((q) => q.table === 'members' && q.op === 'upsert');
    assert.ok(memberWrite > 0, 'the member write happened');
    const before = log.slice(0, memberWrite);
    const byId = before.filter((q) => q.table === 'agents' && q.eqs.some(([c]) => c === 'id'));
    assert.deepEqual(byId, [], email);
    const lookups = before.filter((q) => q.table === 'agents');
    assert.deepEqual(lookups.map((q) => q.eqs), [[['email', email]]], 'one lookup, by email');
    assert.ok(!before.some((q) => q.eqs.some(([, v]) => v === BEE_A.id)), 'bee A\'s id is never queried');
  }
});

test('webhook 002 source: metaAgentId does not appear in the handler', () => {
  assert.ok(!HANDLER_SRC.includes('metaAgentId'));
  const start = HANDLER_SRC.indexOf("if (event.type === 'checkout.session.completed')");
  const write = HANDLER_SRC.indexOf("supabase.from('members').upsert(", start);
  assert.ok(start > 0 && write > start);
  const branchHead = HANDLER_SRC.slice(start, write);
  assert.ok(!branchHead.includes('agent_id'), 'no agent_id between the branch start and the member write');
  assert.match(branchHead, /\.eq\('email', email\)/);
});
