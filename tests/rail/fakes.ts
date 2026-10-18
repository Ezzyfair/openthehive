// tests/rail/fakes.ts
// ----------------------------------------------------------------------------
// NIK-RAIL-004 · the stubs row 4's gate calls for: a fake Stripe and an in-memory
// database implementing the exact chain lib/rail/webhook-handler.ts uses —
//   from · insert · upsert · update · select · eq · in · limit · single ·
//   maybeSingle · delete · rpc
// including `insert(...).select().single()`, which createPersonalHoneycomb uses.
//
// The database does not emulate Postgres. It emulates the three behaviours the
// handler would be wrong without, and nothing else:
//   · stripe_events.event_id is UNIQUE and a duplicate insert returns code 23505 —
//     the claim (R13);
//   · rpc('rail_accrue') returns 0 for a p_invoice_ref it has already seen, which is
//     what the real function's ON CONFLICT on hive_revenue produces — the replay
//     (R1, R2);
//   · every call is recorded, so a test can assert HOW MANY rpc calls happened and
//     not merely what the end state is. "Exactly one write" is the whole point of
//     the concurrency assertion, and final state cannot show it.
//
// Errors are injectable one table at a time, because R14 and R15 are about what
// happens when a specific write fails after the claim.
// ----------------------------------------------------------------------------

export interface DbError { code?: string; message: string }
export interface Call { table: string; op: string; args?: unknown }

type Mode = 'select' | 'insert' | 'upsert' | 'update' | 'delete';

export class FakeDb {
  rows: Record<string, any[]> = {
    stripe_events: [],
    stripe_webhook_failures: [],
    members: [],
    agents: [],
    honeycombs: [],
    messages: [],
    // NIK-RAIL-005 · the two the rail functions write. No handler code touches them
    // (R60/R-H), so nothing in the fake's from() path reaches them either; they are
    // here because railAccrue and railReverse keep their state where a test can read
    // it — db.rows.referral_earnings is how an assertion sees a reversal.
    referral_earnings: [],
    hive_revenue: [],
  };
  calls: Call[] = [];

  /** p_invoice_ref values rail_accrue has already claimed. */
  accrued = new Set<string>();
  rpcCalls: Array<{ fn: string; args: any }> = [];

  /** Injected faults. Each is read by the matching operation and otherwise ignored. */
  rpcError: DbError | null = null;
  /** Fails the DELETE on stripe_events, i.e. the claim release (R14's second branch). */
  releaseError: DbError | null = null;
  /** Fails one table's insert/upsert/update (R15). */
  writeError: { table: string; error: DbError } | null = null;

  from(table: string) {
    const db = this;
    if (!db.rows[table]) db.rows[table] = [];

    let mode: Mode = 'select';
    let staged: DbError | null = null;
    let produced: any[] = [];
    let patch: any = null;
    const filters: Array<[string, any]> = [];

    const matching = () =>
      db.rows[table].filter((r) =>
        filters.every(([k, v]) => (Array.isArray(v) ? v.includes(r[k]) : r[k] === v)),
      );

    const api: any = {
      insert(row: any) {
        mode = 'insert';
        db.calls.push({ table, op: 'insert', args: row });
        const incoming = Array.isArray(row) ? row : [row];
        if (db.writeError && db.writeError.table === table) {
          staged = db.writeError.error;
          return api;
        }
        // The one uniqueness rule that matters: the event claim.
        if (table === 'stripe_events') {
          for (const r of incoming) {
            if (db.rows.stripe_events.some((e) => e.event_id === r.event_id)) {
              staged = { code: '23505', message: 'duplicate key value violates unique constraint' };
              return api;
            }
          }
        }
        for (const r of incoming) {
          const stored = { id: `${table}_${db.rows[table].length + 1}`, ...r };
          db.rows[table].push(stored);
          produced.push(stored);
        }
        return api;
      },

      upsert(row: any, _opts?: { onConflict?: string }) {
        mode = 'upsert';
        db.calls.push({ table, op: 'upsert', args: row });
        if (db.writeError && db.writeError.table === table) {
          staged = db.writeError.error;
          return api;
        }
        for (const r of Array.isArray(row) ? row : [row]) {
          const i = db.rows[table].findIndex((e) => r.email && e.email === r.email);
          if (i >= 0) {
            db.rows[table][i] = { ...db.rows[table][i], ...r };
            produced.push(db.rows[table][i]);
          } else {
            const stored = { id: `${table}_${db.rows[table].length + 1}`, ...r };
            db.rows[table].push(stored);
            produced.push(stored);
          }
        }
        return api;
      },

      update(p: any) {
        mode = 'update';
        patch = p;
        db.calls.push({ table, op: 'update', args: p });
        return api;
      },

      delete() {
        mode = 'delete';
        db.calls.push({ table, op: 'delete' });
        return api;
      },

      select(_cols?: string, _opts?: unknown) {
        return api;
      },
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return api;
      },
      in(col: string, vals: unknown[]) {
        filters.push([col, vals]);
        return api;
      },
      order(_col: string, _o?: unknown) {
        return api;
      },
      limit(_n: number) {
        return api;
      },

      /** Resolve the staged operation. Shared by then/single/maybeSingle. */
      __run(): { data: any; error: DbError | null } {
        if (staged) return { data: null, error: staged };
        if (mode === 'insert' || mode === 'upsert') return { data: produced, error: null };
        if (mode === 'update') {
          if (db.writeError && db.writeError.table === table) {
            return { data: null, error: db.writeError.error };
          }
          const hit = matching();
          for (const r of hit) Object.assign(r, patch);
          return { data: hit, error: null };
        }
        if (mode === 'delete') {
          if (db.releaseError && table === 'stripe_events') {
            return { data: null, error: db.releaseError };
          }
          const hit = matching();
          db.rows[table] = db.rows[table].filter((r) => !hit.includes(r));
          return { data: null, error: null };
        }
        return { data: matching(), error: null };
      },

      single() {
        const r = api.__run();
        return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error });
      },
      maybeSingle() {
        return api.single();
      },
      then(onOk: any, onErr?: any) {
        return Promise.resolve(api.__run()).then(onOk, onErr);
      },
    };
    return api;
  }

  rpc(fn: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ fn, args });
    if (this.rpcError) return Promise.resolve({ data: null, error: this.rpcError });

    if (fn === 'rail_accrue') return this.railAccrue(args);
    if (fn === 'rail_reverse') return this.railReverse(args);

    // NIK-RAIL-005 · AN UNKNOWN NAME THROWS, and that is the point. Until this
    // commit any name but rail_accrue returned { data: null, error: null } — a silent
    // success — so a test against a function the fake knew nothing about passed
    // without exercising anything. The measure called that out as the one fixture
    // gap. Now a new money function has to be taught here before a test can claim it
    // works.
    throw new Error(
      `FakeDb.rpc: no behaviour defined for '${fn}'. Teach the fake this function ` +
        `before asserting against it — a silent success is how a test passes for free.`,
    );
  }

  /** rail_accrue: p_rows.length the first time a ref is seen, 0 on a replay. */
  private railAccrue(args: Record<string, unknown>) {
    const ref = String(args.p_invoice_ref);
    if (this.accrued.has(ref)) {
      // The replay: rail_accrue's ON CONFLICT on hive_revenue wrote nothing.
      return Promise.resolve({ data: 0, error: null });
    }
    this.accrued.add(ref);
    const rows = (args.p_rows as any[]) ?? [];
    // The revenue row IS the claim (F1), and `known` below is read from it — so the
    // fake writes it, exactly as the real function does.
    this.rows.hive_revenue = this.rows.hive_revenue ?? [];
    this.rows.hive_revenue.push({
      stripe_invoice_ref: ref,
      livemode: args.p_livemode,
      source_agent_id: args.p_source_agent,
      source_amount_cents: args.p_source_cents,
      period_month: args.p_period_month,
    });
    this.rows.referral_earnings = this.rows.referral_earnings ?? [];
    for (const r of rows) {
      this.rows.referral_earnings.push({
        stripe_invoice_ref: ref,
        livemode: args.p_livemode,
        earning_agent_id: r.earning_agent_id,
        level: r.level,
        rate_bps: r.rate_bps,
        amount_cents: r.amount_cents,
        status: 'pending',
        reversed_at: null,
        reversal_reason: null,
      });
    }
    return Promise.resolve({ data: rows.length, error: null });
  }

  /**
   * rail_reverse, with M1b's semantics over the fake's own rows:
   *   known     — a hive_revenue row for (ref, livemode) exists
   *   reversed  — pending rows moved to 'reversed' with reversed_at and the reason
   *   untouched — rows already 'in_transit' or 'paid', left exactly as they are
   * Returns an ARRAY of one row, because the real function RETURNS TABLE.
   */
  private railReverse(args: Record<string, unknown>) {
    const ref = String(args.p_invoice_ref);
    const livemode = args.p_livemode;
    const reason = String(args.p_reason);

    // The real function raises 22023 on these; the fake answers with the same error
    // shape the client would see, so the handler's error path is exercised.
    if (!ref || ref.trim() === '' || (reason !== 'refund' && reason !== 'dispute')) {
      return Promise.resolve({
        data: null,
        error: { code: '22023', message: 'rail_reverse: invalid argument' },
      });
    }

    const all = (this.rows.referral_earnings ?? []).filter(
      (r) => r.stripe_invoice_ref === ref && r.livemode === livemode,
    );
    const known = (this.rows.hive_revenue ?? []).some(
      (r) => r.stripe_invoice_ref === ref && r.livemode === livemode,
    );

    let reversed = 0;
    for (const r of all) {
      if (r.status === 'pending') {
        r.status = 'reversed';
        r.reversed_at = new Date().toISOString();
        r.reversal_reason = reason;
        reversed++;
      }
    }
    const untouched = all.filter((r) => r.status === 'in_transit' || r.status === 'paid').length;

    return Promise.resolve({ data: [{ known, reversed, untouched }], error: null });
  }

  // ── what the assertions read ──────────────────────────────────────────────
  countRpc(fn = 'rail_accrue') {
    return this.rpcCalls.filter((c) => c.fn === fn).length;
  }
  lastAccrual() {
    const c = [...this.rpcCalls].reverse().find((x) => x.fn === 'rail_accrue');
    return c ? c.args : null;
  }
  failures(reason?: string) {
    const f = this.rows.stripe_webhook_failures;
    return reason ? f.filter((r) => r.reason === reason) : f;
  }
  member(customerId: string) {
    return this.rows.members.find((m) => m.stripe_customer_id === customerId);
  }
  agent(id: string) {
    return this.rows.agents.find((a) => a.id === id);
  }
}

// ── the fake Stripe ─────────────────────────────────────────────────────────
// Only the three calls lib/rail/accrual.ts makes. Typed `any` at the call site in
// the test, because the real Stripe type is a 300-method class and implementing it
// would be a worse stub, not a better one.

export interface FakeStripeOpts {
  invoice?: any;
  paymentIntent?: any;
  sessionLineItems?: any[];
  /** Make every retrieve throw, for the R14 'resolve' stage. */
  retrieveError?: string;
  // ── NIK-RAIL-005 · the reversal path ──
  /** What invoicePayments.list returns. Default: an EMPTY list, i.e. a one-time
   *  payment, which §5.5 says makes the payment intent itself the ref. */
  invoicePayments?: any[];
  /** Make invoicePayments.list throw — a retry signal, not an unresolved ref. */
  invoicePaymentsError?: string;
  /** What charges.retrieve returns, for a dispute that carries no payment intent. */
  charge?: any;
  /** Make charges.retrieve throw. */
  chargeError?: string;
}

export class FakeStripe {
  retrieveCalls: string[] = [];
  /**
   * Every argument each retrieve was called with. F1's assertion is about what was
   * NOT passed, so the stub has to keep the whole call, not just the id.
   */
  retrieveArgs: Array<{ call: string; params: unknown }> = [];
  /** Every params object invoicePayments.list was called with (NIK-RAIL-005). */
  invoicePaymentsCalls: any[] = [];
  constructor(public opts: FakeStripeOpts = {}) {}

  invoices = {
    retrieve: async (id: string, params?: unknown) => {
      this.retrieveCalls.push(`invoice:${id}`);
      this.retrieveArgs.push({ call: `invoice:${id}`, params });
      if (this.opts.retrieveError) throw new Error(this.opts.retrieveError);
      return this.opts.invoice;
    },
  };

  paymentIntents = {
    retrieve: async (id: string, params?: unknown) => {
      this.retrieveCalls.push(`pi:${id}`);
      this.retrieveArgs.push({ call: `pi:${id}`, params });
      if (this.opts.retrieveError) throw new Error(this.opts.retrieveError);
      return this.opts.paymentIntent;
    },
  };

  checkout = {
    sessions: {
      listLineItems: async (id: string, _p?: unknown) => {
        this.retrieveCalls.push(`lineitems:${id}`);
        return { data: this.opts.sessionLineItems ?? [] };
      },
    },
  };

  /**
   * NIK-RAIL-005 · the invoice-payment lookup resolveRef uses. The whole params
   * object is recorded, because a test has to assert the SHAPE the pinned SDK
   * requires — `payment.type` is mandatory (InvoicePayments.d.ts:124), and a call
   * that omitted it would be a 400 at Stripe, not a local type error.
   */
  invoicePayments = {
    list: async (params?: any) => {
      this.retrieveCalls.push('invoicePayments.list');
      this.invoicePaymentsCalls.push(params);
      if (this.opts.invoicePaymentsError) throw new Error(this.opts.invoicePaymentsError);
      return { data: this.opts.invoicePayments ?? [] };
    },
  };

  /** The charge fetch a dispute needs only when it carries no payment intent. */
  charges = {
    retrieve: async (id: string, params?: unknown) => {
      this.retrieveCalls.push(`charge:${id}`);
      this.retrieveArgs.push({ call: `charge:${id}`, params });
      if (this.opts.chargeError) throw new Error(this.opts.chargeError);
      return this.opts.charge;
    },
  };
}

// ── builders ────────────────────────────────────────────────────────────────

/**
 * An invoice line carrying a price id in the shape the INSTALLED SDK defines for
 * the pinned version: InvoiceLineItem has no `.price`; the id is at
 * pricing.price_details.price. The grep that establishes this is in the packet.
 */
export const invoiceLine = (priceId: string | null) => ({
  pricing: priceId === null ? null : { type: 'price_details', price_details: { price: priceId } },
});

/** A checkout LineItem, whose price is a full Price object — a different shape. */
export const sessionLine = (priceId: string | null) => ({
  price: priceId === null ? null : { id: priceId },
});

export const fakeInvoice = (o: {
  id?: string;
  amountPaid: number;
  customer?: string | null;
  periodStart?: number;
  livemode?: boolean;
  priceIds?: Array<string | null>;
  /** F5 · the line list is paginated and this is only its first page. */
  linesHasMore?: boolean;
}) => ({
  id: o.id ?? 'in_test_1',
  amount_paid: o.amountPaid,
  customer: o.customer === undefined ? 'cus_test_1' : o.customer,
  // 2026-10-01T00:30:00Z — inside the first UTC day, so a local-time month read
  // in a negative-offset zone would answer September and the test would catch it.
  period_start: o.periodStart ?? Math.floor(Date.UTC(2026, 9, 1, 0, 30) / 1000),
  livemode: o.livemode ?? false,
  lines: {
    data: (o.priceIds ?? ['price_worker_test']).map(invoiceLine),
    has_more: o.linesHasMore ?? false,
  },
});

export const fakeEvent = (
  type: string,
  object: unknown,
  o?: { id?: string; ageSeconds?: number; livemode?: boolean },
) =>
  ({
    id: o?.id ?? 'evt_test_1',
    type,
    created: Math.floor(Date.now() / 1000) - (o?.ageSeconds ?? 10),
    // EventBase.livemode (Events.d.ts:43). The reversal path passes it straight to
    // rail_reverse as p_livemode, where it is half the key, so a fixture that omitted
    // it would silently reverse in the wrong mode — i.e. find nothing.
    livemode: o?.livemode ?? false,
    data: { object },
  }) as any;

// ── NIK-RAIL-005 builders ───────────────────────────────────────────────────

/** A Charge as charge.refunded carries it (Charges.d.ts:51). */
export const fakeCharge = (o: {
  id?: string;
  paymentIntent?: string | { id: string } | null;
  amount?: number;
  amountRefunded?: number;
  refunded?: boolean;
}) => ({
  id: o.id ?? 'ch_test_1',
  object: 'charge',
  amount: o.amount ?? 1000,
  amount_refunded: o.amountRefunded ?? 1000,
  refunded: o.refunded ?? true,
  payment_intent: o.paymentIntent === undefined ? 'pi_test_1' : o.paymentIntent,
});

/** A Dispute as charge.dispute.created carries it (Disputes.d.ts:30). */
export const fakeDispute = (o: {
  id?: string;
  charge?: string | { id: string };
  paymentIntent?: string | { id: string } | null;
  amount?: number;
  reason?: string;
}) => ({
  id: o.id ?? 'dp_test_1',
  object: 'dispute',
  amount: o.amount ?? 1000,
  charge: o.charge ?? 'ch_test_1',
  payment_intent: o.paymentIntent === undefined ? null : o.paymentIntent,
  reason: o.reason ?? 'fraudulent',
  status: 'needs_response',
});

/** An InvoicePayment row as invoicePayments.list returns it (InvoicePayments.d.ts:18). */
export const fakeInvoicePayment = (invoice: string | { id: string } | null) => ({
  id: 'inpay_test_1',
  object: 'invoice_payment',
  invoice,
  status: 'paid',
});
