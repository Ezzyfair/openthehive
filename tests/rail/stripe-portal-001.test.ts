// tests/rail/stripe-portal-001.test.ts
// ----------------------------------------------------------------------------
// THE HIVE — STRIPE-PORTAL-001. Runs under the repo's rail test command:
//   npm run test:rail
//
// One rule for both Stripe routes: the request body never says who the request
// is for.
//
// WHAT IS REAL AND WHAT IS STUBBED:
//   PORTAL   — REAL: lib/rail/portal.ts openMemberPortal(), the whole handler the
//              route calls, including its rendering through memberJson /
//              memberErrorResponse. STUBBED: its three dependencies (the member
//              session, the members row read, the Stripe factory), passed in as
//              arguments the way handleStripeEvent takes its HandlerDeps.
//   CHECKOUT — REAL: app/api/stripe/checkout/route.ts POST, called directly with a
//              real Request. STUBBED: the Stripe factory only. The route is kept
//              byte-for-byte apart from the ticket's two removals, so its logic is
//              not moved; instead the railStripe export of the compiled
//              lib/rail/stripe module is replaced for the duration of a call (the
//              compiled route reads that export at call time). No real Stripe
//              client is ever constructed.
//   SOURCE   — both route files are read from the repo (not dist).
//
// No network, no database, no Stripe. The price-id env vars are obvious fakes.
// ----------------------------------------------------------------------------
import './resolver'; // MUST stay first: installs the '@/...' require hook.
import test from 'node:test';
import assert from 'node:assert/strict';

import { BeeError } from '@/lib/antenna/errors';
import { openMemberPortal, PORTAL_RETURN_URL, type PortalDeps } from '@/lib/rail/portal';
import * as checkoutRoute from '@/app/api/stripe/checkout/route';

const nodeFs: any = require('node:fs');
const nodePath: any = require('node:path');
// The live exports object of the compiled factory module, the one the route reads.
const stripeModule: any = require('@/lib/rail/stripe');

/** The repo root, from <dist>/tests/rail/. Source files are read from there, not dist. */
const REPO_ROOT: string = nodePath.resolve(__dirname, '..', '..', '..');
const PORTAL_SRC: string = nodeFs.readFileSync(
  nodePath.join(REPO_ROOT, 'app', 'api', 'stripe', 'portal', 'route.ts'), 'utf8');
const CHECKOUT_SRC: string = nodeFs.readFileSync(
  nodePath.join(REPO_ROOT, 'app', 'api', 'stripe', 'checkout', 'route.ts'), 'utf8');

process.env.STRIPE_WORKER_BEE_PRICE_ID = 'price_fake_worker_sp001';
process.env.STRIPE_HONEY_MAKER_PRICE_ID = 'price_fake_honey_sp001';
process.env.STRIPE_QUEENS_COUNCIL_PRICE_ID = 'price_fake_queens_sp001';

// ── portal fakes ────────────────────────────────────────────────────────────

const MEMBER_ID = 'mem_sp001_a';
const CUSTOMER = 'cus_fake_sp001_a';
const STRIPE_SECRET_MESSAGE = 'No such customer: cus_fake_sp001_a; request req_fake_leak';

function portalHarness(opts: {
  session?: () => Promise<{ member_id: string }>;
  row?: { stripe_customer_id: string | null } | null;
  rowThrows?: string;
  stripeThrows?: string;
}) {
  const calls = { factory: 0, create: [] as any[], rowReads: [] as string[] };
  const deps: PortalDeps = {
    session: opts.session ?? (async () => ({ member_id: MEMBER_ID })),
    memberRow: async (memberId) => {
      calls.rowReads.push(memberId);
      if (opts.rowThrows) throw new Error(opts.rowThrows);
      return opts.row === undefined ? { stripe_customer_id: CUSTOMER } : opts.row;
    },
    stripe: () => {
      calls.factory += 1;
      return {
        billingPortal: {
          sessions: {
            create: async (params) => {
              calls.create.push(params);
              if (opts.stripeThrows) throw new Error(opts.stripeThrows);
              return { url: 'https://billing.stripe.example/session/fake' };
            },
          },
        },
      };
    },
  };
  return { deps, calls };
}

async function runPortal(h: { deps: PortalDeps }) {
  const res: Response = await openMemberPortal(h.deps);
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text), cache: res.headers.get('Cache-Control') };
}

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

// ── portal: behaviour ───────────────────────────────────────────────────────

test('portal: not signed in answers 401 not_signed_in and Stripe is never touched', async () => {
  const h = portalHarness({
    session: async () => { throw new BeeError(401, 'not_signed_in', 'sign in at /member/login'); },
  });
  const r = await runPortal(h);
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'not_signed_in');
  assert.equal(h.calls.rowReads.length, 0);
  assert.equal(h.calls.factory, 0);
  assert.equal(h.calls.create.length, 0);
});

test('portal: signed in with no member row (session refusal) answers 403 not_a_member, no Stripe', async () => {
  const h = portalHarness({
    session: async () => { throw new BeeError(403, 'not_a_member', 'this account is not linked to a Hive membership'); },
  });
  const r = await runPortal(h);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'not_a_member');
  assert.equal(h.calls.factory, 0);
  assert.equal(h.calls.create.length, 0);
});

test('portal: a session whose members row is gone by id answers 403 not_a_member, no Stripe', async () => {
  const h = portalHarness({ row: null });
  const r = await runPortal(h);
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'not_a_member');
  assert.deepEqual(h.calls.rowReads, [MEMBER_ID]);
  assert.equal(h.calls.factory, 0);
  assert.equal(h.calls.create.length, 0);
});

test('portal: a member with no customer id answers 409 no_billing_account, no Stripe', async () => {
  const h = portalHarness({ row: { stripe_customer_id: null } });
  const r = await runPortal(h);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'no_billing_account');
  assert.equal(h.calls.factory, 0);
  assert.equal(h.calls.create.length, 0);
});

test('portal: a member with a customer id answers 200 { url } and Stripe is called once for that customer', async () => {
  const h = portalHarness({});
  const r = await runPortal(h);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { url: 'https://billing.stripe.example/session/fake' });
  assert.deepEqual(Object.keys(r.body), ['url']);
  assert.deepEqual(h.calls.rowReads, [MEMBER_ID]);
  assert.equal(h.calls.factory, 1);
  assert.equal(h.calls.create.length, 1);
  assert.deepEqual(h.calls.create[0], { customer: CUSTOMER, return_url: 'https://www.openthehive.ai/member' });
  assert.equal(PORTAL_RETURN_URL, 'https://www.openthehive.ai/member');
});

test('portal: the row read uses the session member id, never anything else', async () => {
  const h = portalHarness({ session: async () => ({ member_id: 'mem_sp001_other' }) });
  await runPortal(h);
  assert.deepEqual(h.calls.rowReads, ['mem_sp001_other']);
});

test('portal: Stripe throwing answers 500 internal_error and the body does not carry the thrown message', async () => {
  const h = portalHarness({ stripeThrows: STRIPE_SECRET_MESSAGE });
  const { result: r, logged } = await captureErrors(() => runPortal(h));
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'internal_error');
  assert.ok(!r.text.includes(STRIPE_SECRET_MESSAGE));
  assert.ok(!r.text.includes('cus_fake_sp001_a'));
  assert.ok(!r.text.includes('req_fake_leak'));
  assert.ok(logged.includes(STRIPE_SECRET_MESSAGE), 'the thrown message goes to console.error');
});

test('portal: a failing members read answers 500 internal_error, no Stripe, nothing echoed', async () => {
  const h = portalHarness({ rowThrows: 'members read failed: relation secret_detail' });
  const { result: r } = await captureErrors(() => runPortal(h));
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'internal_error');
  assert.ok(!r.text.includes('secret_detail'));
  assert.equal(h.calls.factory, 0);
});

test('portal: every answer carries the member no-store cache header', async () => {
  const ok = await runPortal(portalHarness({}));
  const refused = await runPortal(portalHarness({ row: { stripe_customer_id: null } }));
  assert.equal(ok.cache, 'private, no-store');
  assert.equal(refused.cache, 'private, no-store');
});

// ── portal: source ──────────────────────────────────────────────────────────

test('portal source: no req.json, no customerId, no searchParams, no header read', () => {
  assert.ok(!PORTAL_SRC.includes('req.json'));
  assert.ok(!PORTAL_SRC.includes('customerId'));
  assert.ok(!PORTAL_SRC.includes('searchParams'));
  assert.ok(!/headers\s*\.\s*get\s*\(/.test(PORTAL_SRC));
  assert.match(PORTAL_SRC, /export async function POST\(\)/, 'POST takes no argument');
  assert.match(PORTAL_SRC, /resolveMemberSession\(\)/);
});

test('portal source: there is no GET export', () => {
  assert.ok(!/export\s+(async\s+)?function\s+GET\b/.test(PORTAL_SRC));
  assert.ok(!/export\s+const\s+GET\b/.test(PORTAL_SRC));
});

test('portal source: the four no-cache exports are still present', () => {
  assert.match(PORTAL_SRC, /^export const runtime = 'nodejs';$/m);
  assert.match(PORTAL_SRC, /^export const dynamic = 'force-dynamic';$/m);
  assert.match(PORTAL_SRC, /^export const fetchCache = 'force-no-store';$/m);
  assert.match(PORTAL_SRC, /^export const revalidate = 0;$/m);
});

// ── checkout ────────────────────────────────────────────────────────────────

/** Calls the real checkout POST with a stubbed Stripe factory; records every create. */
async function runCheckout(body: Record<string, unknown>) {
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
    return { status: res.status, body: await res.json(), creates, factory };
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

test('checkout: memberOfRecord not true answers 400 and Stripe is never called', async () => {
  for (const flag of [false, undefined, 'true', 1]) {
    const r = await runCheckout({ ...JOIN_BODY, memberOfRecord: flag });
    assert.equal(r.status, 400);
    assert.equal(r.factory, 0);
    assert.equal(r.creates.length, 0);
  }
});

test('checkout: an unknown tier answers 400 and Stripe is never called', async () => {
  const r = await runCheckout({ ...JOIN_BODY, tier: 'drone' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'Invalid tier' });
  assert.equal(r.creates.length, 0);
});

test('checkout: a valid request creates a session whose metadata has exactly tier, agentName, soul', async () => {
  const r = await runCheckout(JOIN_BODY);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { url: 'https://checkout.stripe.example/c/fake' });
  assert.equal(r.creates.length, 1);
  assert.deepEqual(Object.keys(r.creates[0].metadata).sort(), ['agentName', 'soul', 'tier']);
  assert.deepEqual(r.creates[0].metadata, { tier: 'worker', agentName: 'Fake Bee', soul: 'The Operator' });
});

test('checkout: the same request with an agentId added makes a deep-equal Stripe call', async () => {
  const without = await runCheckout(JOIN_BODY);
  const withId = await runCheckout({ ...JOIN_BODY, agentId: '00000000-0000-0000-0000-00000000beef' });
  assert.equal(withId.status, 200, 'a request carrying the field is not refused');
  assert.deepEqual(withId.body, without.body);
  assert.equal(withId.creates.length, 1);
  assert.deepEqual(withId.creates[0], without.creates[0]);
  assert.ok(!JSON.stringify(withId.creates[0]).includes('beef'));
});

test('checkout: worker and honey create a subscription, queens a payment', async () => {
  const expected: Record<string, string> = { worker: 'subscription', honey: 'subscription', queens: 'payment' };
  for (const tier of Object.keys(expected)) {
    const r = await runCheckout({ ...JOIN_BODY, tier });
    assert.equal(r.status, 200);
    assert.equal(r.creates[0].mode, expected[tier], tier);
  }
});

test('checkout: the URLs and the line item are unchanged', async () => {
  const r = await runCheckout({ ...JOIN_BODY, tier: 'honey' });
  const p = r.creates[0];
  assert.deepEqual(p.line_items, [{ price: 'price_fake_honey_sp001', quantity: 1 }]);
  assert.equal(p.customer_email, 'payer@example.test');
  assert.equal(p.cancel_url, 'https://openthehive.ai/pricing');
  assert.ok(p.success_url.startsWith('https://openthehive.ai/join/success?session_id='));
});

test('checkout source: the file contains neither agentId nor agent_id', () => {
  assert.ok(!CHECKOUT_SRC.includes('agentId'));
  assert.ok(!CHECKOUT_SRC.includes('agent_id'));
});
