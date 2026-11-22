// tests/rail/council-post-001.test.ts
// ----------------------------------------------------------------------------
// THE HIVE — COUNCIL-POST-001. Runs under the repo's rail test command:
//   npm run test:rail
//
// The exam hold on app/api/honeycombs/post/route.ts ("Coach suppression") is
// decided by the agent's staff flag, never by its tier. queens_council is also a
// paid membership tier, so a non-staff Queen's Council member is never refused.
//
// WHAT IS REAL AND WHAT IS STUBBED:
//   ROUTE  — REAL: the POST exported by app/api/honeycombs/post/route.ts, called
//            with a real Request, as tests/rail/stripe-checkout-002.test.ts drives
//            the checkout route.
//            STUBBED: createClient on the object require('@supabase/supabase-js')
//            returns, rebound for the length of one call and restored in a finally
//            (the same way stripe-checkout-002 rebinds railStripe). The route calls
//            createClient inside getSupabase() at request time, so it gets the
//            in-memory stand-in below. No network, no database.
//   SOURCE — the route is read from the repo (not dist) for tests 11 and 12.
// ----------------------------------------------------------------------------
import './resolver'; // MUST stay first: installs the '@/...' require hook.
import test from 'node:test';
import assert from 'node:assert/strict';

import * as postRoute from '@/app/api/honeycombs/post/route';

const nodeFs: any = require('node:fs');
const nodePath: any = require('node:path');
const supabaseModule: any = require('@supabase/supabase-js');

const REPO_ROOT: string = nodePath.resolve(__dirname, '..', '..', '..');
const ROUTE_SRC: string = nodeFs.readFileSync(
  nodePath.join(REPO_ROOT, 'app', 'api', 'honeycombs', 'post', 'route.ts'), 'utf8');

const EXAM_409_TEXT =
  'Elder verification in progress in this chamber — staff posts are suppressed until it completes';

// ── the in-memory stand-in ──────────────────────────────────────────────────

type Row = Record<string, any>;
interface Tables { [table: string]: Row[] }
interface Seen { table: string; op: string; calls: string[] }

/** One query chain. Filters are applied when the chain ends (single, maybeSingle, await). */
class Query {
  private filters: Array<(r: Row) => boolean> = [];
  private limitN: number | null = null;
  private insertRow: Row | null = null;

  constructor(private db: FakeSupabase, private seen: Seen) {}

  select(_cols?: string) { this.seen.calls.push('select'); return this; }
  eq(col: string, val: any) {
    this.seen.calls.push(`eq:${col}`);
    this.filters.push((r) => r[col] === val);
    return this;
  }
  is(col: string, val: any) {
    this.seen.calls.push(`is:${col}`);
    this.filters.push((r) => (val === null ? r[col] === null || r[col] === undefined : r[col] === val));
    return this;
  }
  ilike(col: string, pattern: string) {
    this.seen.calls.push(`ilike:${col}`);
    const needle = pattern.replace(/^%/, '').replace(/%$/, '').toLowerCase();
    this.filters.push((r) => typeof r[col] === 'string' && r[col].toLowerCase().includes(needle));
    return this;
  }
  /** Supports the one form the route uses: comma-separated "col.eq.value" terms, OR-ed. */
  or(expr: string) {
    this.seen.calls.push(`or:${expr}`);
    const terms = expr.split(',').map((t) => {
      const [col, op, ...rest] = t.split('.');
      if (op !== 'eq') throw new Error('stand-in: unsupported or() operator ' + op);
      return { col, val: rest.join('.') };
    });
    this.filters.push((r) => terms.some((t) => String(r[t.col]) === t.val));
    return this;
  }
  limit(n: number) { this.seen.calls.push(`limit:${n}`); this.limitN = n; return this; }
  insert(row: Row) { this.seen.op = 'insert'; this.seen.calls.push('insert'); this.insertRow = row; return this; }

  private rows(): Row[] {
    if (this.insertRow) {
      const row = { id: `msg-${this.db.tables.messages.length + 1}`, ...this.insertRow };
      this.db.tables[this.seen.table].push(row);
      this.insertRow = null;
      return [row];
    }
    let out = (this.db.tables[this.seen.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    return out;
  }
  async single() {
    this.seen.calls.push('single');
    const rows = this.rows();
    return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: { message: 'not one row' } };
  }
  async maybeSingle() {
    this.seen.calls.push('maybeSingle');
    const rows = this.rows();
    if (rows.length > 1) return { data: null, error: { message: 'more than one row' } };
    return { data: rows[0] ?? null, error: null };
  }
  then(resolve: (v: any) => any, reject?: (e: any) => any) {
    this.seen.calls.push('await');
    return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
  }
}

class FakeSupabase {
  seen: Seen[] = [];
  constructor(public tables: Tables) {}
  from(table: string) {
    const s: Seen = { table, op: 'read', calls: [] };
    this.seen.push(s);
    return new Query(this, s);
  }
  tablesAsked(): string[] { return this.seen.map((s) => s.table); }
}

// ── fixtures ────────────────────────────────────────────────────────────────

const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const OWN_CHAMBER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_CHAMBER_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ROOM_ID = '44444444-4444-4444-8444-444444444444';
const POSTER_ID = 'agent-poster';
const OTHER_ID = 'agent-other';
const KEY = 'hive_fake_council_post_001';

function poster(is_staff: boolean | null, tier: string | null): Row {
  return {
    id: POSTER_ID, name: 'Fake Poster', status: 'active', soul: 'The Operator',
    soul_emoji: 'x', tier, is_staff, agent_api_key: KEY,
  };
}

function honeycombs(): Row[] {
  return [
    { id: ROOM_ID, title: 'Colony Room', type: 'hive', creator_id: 'agent-founder', status: 'active' },
    { id: OTHER_ROOM_ID, title: 'Second Room', type: 'hive', creator_id: 'agent-founder', status: 'active' },
    { id: OWN_CHAMBER_ID, title: 'Poster Chamber', type: 'personal', creator_id: POSTER_ID, status: 'active' },
    { id: OTHER_CHAMBER_ID, title: 'Other Chamber', type: 'personal', creator_id: OTHER_ID, status: 'active' },
  ];
}

function openExamIn(honeycomb_id: string): Row {
  return { id: `exam-${honeycomb_id}`, honeycomb_id, completed_at: null };
}

function world(agent: Row, exams: Row[]): Tables {
  return {
    agents: [agent, { id: OTHER_ID, name: 'Other Bee', status: 'active', tier: 'worker_bee', is_staff: false, agent_api_key: 'hive_fake_other' }],
    honeycombs: honeycombs(),
    elder_conversations: exams,
    messages: [],
  };
}

async function runPost(tables: Tables, body: Record<string, unknown>) {
  const db = new FakeSupabase(tables);
  let factory = 0;
  const original = supabaseModule.createClient;
  supabaseModule.createClient = () => { factory += 1; return db; };
  try {
    const req = new Request('https://example.invalid/api/honeycombs/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res: Response = await (postRoute.POST as any)(req);
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text), db, factory, messages: tables.messages };
  } finally {
    supabaseModule.createClient = original;
  }
}

function postBody(honeycomb_id: string, extra: Record<string, unknown> = {}) {
  return { agent_name: 'Fake Poster', honeycomb_id, content: 'hello colony', api_key: KEY, ...extra };
}

// ── behaviour ───────────────────────────────────────────────────────────────

test('council-post 001 · 0: the stand-in is the client the route uses', async () => {
  const r = await runPost(world(poster(false, 'worker_bee'), []), postBody(ROOM_ID));
  assert.equal(r.factory, 1);
  assert.ok(r.db.tablesAsked().includes('agents'));
  assert.equal(r.status, 200);
});

test('council-post 001 · 1: a non-staff queens_council agent posts in a colony room during an open exam (the finding)', async () => {
  const r = await runPost(world(poster(false, 'queens_council'), [openExamIn(ROOM_ID)]), postBody(ROOM_ID));
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].honeycomb_id, ROOM_ID);
  assert.equal(r.messages[0].agent_id, POSTER_ID);
});

test('council-post 001 · 2: the same agent posts in its own personal chamber during an open exam there', async () => {
  const r = await runPost(world(poster(false, 'queens_council'), [openExamIn(OWN_CHAMBER_ID)]), postBody(OWN_CHAMBER_ID));
  assert.equal(r.status, 200);
  assert.equal(r.messages.length, 1);
  assert.equal(r.messages[0].honeycomb_id, OWN_CHAMBER_ID);
});

test('council-post 001 · 3: a non-staff elder-tier agent posts during an open exam (the flag decides, not the tier)', async () => {
  const r = await runPost(world(poster(false, 'elder'), [openExamIn(ROOM_ID)]), postBody(ROOM_ID));
  assert.equal(r.status, 200);
  assert.equal(r.messages.length, 1);
});

test('council-post 001 · 4: an agent with is_staff null and tier queens_council posts during an open exam', async () => {
  const r = await runPost(world(poster(null, 'queens_council'), [openExamIn(ROOM_ID)]), postBody(ROOM_ID));
  assert.equal(r.status, 200);
  assert.equal(r.messages.length, 1);
});

test('council-post 001 · 5: a staff queens_council agent is held with 409 and the exact body; nothing is written', async () => {
  const r = await runPost(world(poster(true, 'queens_council'), [openExamIn(ROOM_ID)]), postBody(ROOM_ID));
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: EXAM_409_TEXT });
  assert.deepEqual(Object.keys(r.body), ['error']);
  assert.equal(r.messages.length, 0);
  assert.ok(!r.db.tablesAsked().includes('messages'));
});

test('council-post 001 · 6: a staff elder-tier agent is held with 409 during an open exam', async () => {
  const r = await runPost(world(poster(true, 'elder'), [openExamIn(ROOM_ID)]), postBody(ROOM_ID));
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: EXAM_409_TEXT });
  assert.equal(r.messages.length, 0);
});

test('council-post 001 · 7: staff with tier worker_bee, and staff with tier null, are each held with 409 (table row two)', async () => {
  const a = await runPost(world(poster(true, 'worker_bee'), [openExamIn(ROOM_ID)]), postBody(ROOM_ID));
  assert.equal(a.status, 409);
  assert.equal(a.messages.length, 0);
  const b = await runPost(world(poster(true, null), [openExamIn(ROOM_ID)]), postBody(ROOM_ID));
  assert.equal(b.status, 409);
  assert.equal(b.messages.length, 0);
});

test('council-post 001 · 8: a staff agent posts when the only exams are completed or in another honeycomb', async () => {
  const exams = [
    { id: 'exam-done', honeycomb_id: ROOM_ID, completed_at: '2026-11-20T00:00:00Z' },
    openExamIn(OTHER_ROOM_ID),
  ];
  const r = await runPost(world(poster(true, 'elder'), exams), postBody(ROOM_ID));
  assert.equal(r.status, 200);
  assert.equal(r.messages.length, 1);
  assert.ok(r.db.tablesAsked().includes('elder_conversations'));
});

test('council-post 001 · 9: for a non-staff poster the route never reads elder_conversations', async () => {
  for (const tier of ['queens_council', 'elder', 'worker_bee', null]) {
    for (const flag of [false, null]) {
      const r = await runPost(world(poster(flag, tier), [openExamIn(ROOM_ID)]), postBody(ROOM_ID));
      assert.equal(r.status, 200, `tier ${tier} flag ${flag}`);
      assert.ok(!r.db.tablesAsked().includes('elder_conversations'), `tier ${tier} flag ${flag}`);
    }
  }
});

test('council-post 001 · table: non-staff other tier posts during an exam; anyone posts with no exam', async () => {
  const a = await runPost(world(poster(false, 'honey_maker'), [openExamIn(ROOM_ID)]), postBody(ROOM_ID));
  assert.equal(a.status, 200);
  for (const [flag, tier] of [[true, 'elder'], [true, 'queens_council'], [true, null], [false, 'queens_council'], [null, 'worker_bee']] as const) {
    const r = await runPost(world(poster(flag, tier), []), postBody(ROOM_ID));
    assert.equal(r.status, 200, `flag ${flag} tier ${tier}`);
    assert.equal(r.messages.length, 1);
  }
});

test('council-post 001 · title path: a staff agent naming the room by title is held too', async () => {
  const r = await runPost(world(poster(true, 'worker_bee'), [openExamIn(ROOM_ID)]),
    { agent_name: 'Fake Poster', honeycomb_title: 'Colony', content: 'hello', api_key: KEY });
  assert.equal(r.status, 409);
  const s = await runPost(world(poster(false, 'queens_council'), [openExamIn(ROOM_ID)]),
    { agent_name: 'Fake Poster', honeycomb_title: 'Colony', content: 'hello', api_key: KEY });
  assert.equal(s.status, 200);
});

test('council-post 001 · 10a: a missing field answers 400', async () => {
  const r = await runPost(world(poster(false, 'queens_council'), []), { agent_name: 'Fake Poster', honeycomb_id: ROOM_ID, api_key: KEY });
  assert.equal(r.status, 400);
});

test('council-post 001 · 10b: an unknown key answers 404', async () => {
  const r = await runPost(world(poster(false, 'queens_council'), []), postBody(ROOM_ID, { api_key: 'hive_fake_unknown' }));
  assert.equal(r.status, 404);
});

test('council-post 001 · 10c: a key that does not match the name answers 403', async () => {
  const r = await runPost(world(poster(false, 'queens_council'), []), postBody(ROOM_ID, { agent_name: 'Someone Else' }));
  assert.equal(r.status, 403);
});

test("council-post 001 · 10d: a non-staff agent naming another agent's personal chamber by id answers 404", async () => {
  const r = await runPost(world(poster(false, 'queens_council'), []), postBody(OTHER_CHAMBER_ID));
  assert.equal(r.status, 404);
  assert.equal(r.messages.length, 0);
});

// ── source ──────────────────────────────────────────────────────────────────

const NEW_COMMENT =
  '    // COUNCIL-POST-001 (Nov 21, 2026): decided by the staff flag, never by tier. queens_council is also a paid membership tier.';

test('council-post 001 · 11: the route no longer tests the tier; queens_council appears only in the new comment', () => {
  assert.ok(!ROUTE_SRC.includes('includes(agent.tier)'));
  const lines = ROUTE_SRC.split('\n').filter((l) => l.includes('queens_council'));
  assert.deepEqual(lines, [NEW_COMMENT]);
  assert.ok(ROUTE_SRC.includes(NEW_COMMENT + '\n    if (agent.is_staff === true) {\n'));
});

// Lines 116-127 of the route as on base 4963408, verbatim.
const BASE_116_127 = [
  "      const { data: openExam } = await supabase",
  "        .from('elder_conversations')",
  "        .select('id')",
  "        .eq('honeycomb_id', honeycomb.id)",
  "        .is('completed_at', null)",
  "        .limit(1);",
  "      if (openExam && openExam.length > 0) {",
  "        return NextResponse.json(",
  "          { error: 'Elder verification in progress in this chamber — staff posts are suppressed until it completes' },",
  "          { status: 409 }",
  "        );",
  "      }",
].join('\n');

test('council-post 001 · 12: the base lookup and 409 answer (base lines 116-127) are unchanged', () => {
  assert.ok(ROUTE_SRC.includes('    if (agent.is_staff === true) {\n' + BASE_116_127 + '\n    }\n'));
});
