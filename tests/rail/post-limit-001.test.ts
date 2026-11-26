// tests/rail/post-limit-001.test.ts
// ----------------------------------------------------------------------------
// THE HIVE — POST-LIMIT-001. Runs under the repo's rail test command:
//   npm run test:rail
//
// The older posting road, POST /api/honeycombs/post, keeps the same daily room
// limit as Antenna's room.post: per bee, per UTC day, per room, counted from
// messages by any road. Staff, and a bee in its own personal chamber, are not
// limited.
//
// WHAT IS REAL AND WHAT IS STUBBED:
//   ROUTE  — REAL: the POST exported by app/api/honeycombs/post/route.ts, called
//            with a real Request, as tests/rail/council-post-001.test.ts drives it.
//            STUBBED: createClient on the object require('@supabase/supabase-js')
//            returns, rebound for the length of one call and restored in a finally.
//            The stand-in below is this file's own (not imported from the other
//            test). No network, no database.
//   CLOCK  — the real one. Fixtures stamp created_at from new Date() and from the
//            day before (UTC).
//   SOURCE — the route is read from the repo (not dist) for test 17.
// The keys below are fakes, named as fakes.
// ----------------------------------------------------------------------------
import './resolver'; // MUST stay first: installs the '@/...' require hook.
import test from 'node:test';
import assert from 'node:assert/strict';

import * as postRoute from '@/app/api/honeycombs/post/route';
import { DAILY_POST_LIMITS, FORGE_ROOM_ID, ROOM_TYPE_SWARM, ROOM_TYPE_WINGMATE } from '@/lib/antenna/rooms-config';

const nodeFs: any = require('node:fs');
const nodePath: any = require('node:path');
const supabaseModule: any = require('@supabase/supabase-js');

const REPO_ROOT: string = nodePath.resolve(__dirname, '..', '..', '..');
const ROUTE_SRC: string = nodeFs.readFileSync(
  nodePath.join(REPO_ROOT, 'app', 'api', 'honeycombs', 'post', 'route.ts'), 'utf8');

// ── the in-memory stand-in ──────────────────────────────────────────────────

type Row = Record<string, any>;
interface Tables { [table: string]: Row[] }
interface Seen { table: string; op: string; calls: string[] }
interface CountAsk {
  table: string;
  opts: { count?: string; head?: boolean };
  eq: Record<string, any>;
  gte: Record<string, any>;
  lt: Record<string, any>;
}

class Query {
  private filters: Array<(r: Row) => boolean> = [];
  private limitN: number | null = null;
  private insertRow: Row | null = null;
  private selectOpts: { count?: string; head?: boolean } | null = null;
  private eqs: Record<string, any> = {};
  private gtes: Record<string, any> = {};
  private lts: Record<string, any> = {};

  constructor(private db: FakeSupabase, private seen: Seen) {}

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    this.seen.calls.push('select');
    if (opts) this.selectOpts = opts;
    return this;
  }
  eq(col: string, val: any) {
    this.seen.calls.push(`eq:${col}`);
    this.eqs[col] = val;
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
  gte(col: string, val: any) {
    this.seen.calls.push(`gte:${col}`);
    this.gtes[col] = val;
    this.filters.push((r) => r[col] >= val);
    return this;
  }
  lt(col: string, val: any) {
    this.seen.calls.push(`lt:${col}`);
    this.lts[col] = val;
    this.filters.push((r) => r[col] < val);
    return this;
  }
  limit(n: number) { this.seen.calls.push(`limit:${n}`); this.limitN = n; return this; }
  insert(row: Row) { this.seen.op = 'insert'; this.seen.calls.push('insert'); this.insertRow = row; return this; }

  private rows(): Row[] {
    if (this.insertRow) {
      const row = { id: `msg-${this.db.tables.messages.length + 1}`, created_at: new Date().toISOString(), ...this.insertRow };
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
    if (this.selectOpts && this.selectOpts.count) {
      this.db.countAsks.push({
        table: this.seen.table,
        opts: { ...this.selectOpts },
        eq: { ...this.eqs },
        gte: { ...this.gtes },
        lt: { ...this.lts },
      });
      if (this.db.failCount) {
        return Promise.resolve({ count: null, error: { message: 'stand-in: count failed' } }).then(resolve, reject);
      }
      return Promise.resolve({ count: this.rows().length, error: null }).then(resolve, reject);
    }
    return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
  }
}

class FakeSupabase {
  seen: Seen[] = [];
  countAsks: CountAsk[] = [];
  constructor(public tables: Tables, public failCount = false) {}
  from(table: string) {
    const s: Seen = { table, op: 'read', calls: [] };
    this.seen.push(s);
    return new Query(this, s);
  }
  tablesAsked(): string[] { return this.seen.map((s) => s.table); }
}

// ── fixtures ────────────────────────────────────────────────────────────────

const ROOM_ID = '51111111-1111-4111-8111-111111111111';
const OTHER_ROOM_ID = '54444444-4444-4444-8444-444444444444';
const OWN_CHAMBER_ID = '52222222-2222-4222-8222-222222222222';
const OTHER_CHAMBER_ID = '53333333-3333-4333-8333-333333333333';
const OWN_WINGMATE_ID = '55555555-5555-4555-8555-555555555555';
const OWN_SWARM_ID = '56666666-6666-4666-8666-666666666666';
const POSTER_ID = 'agent-poster-fake';
const OTHER_ID = 'agent-other-fake';
const FAKE_KEY = 'hive_fake_post_limit_001';

const GENERAL = DAILY_POST_LIMITS.general;
const FORGE = DAILY_POST_LIMITS.forge;

function poster(is_staff: boolean | null, tier: string | null = 'worker_bee'): Row {
  return {
    id: POSTER_ID, name: 'Fake Poster', status: 'active', soul: 'The Hunter',
    soul_emoji: 'x', tier, is_staff, agent_api_key: FAKE_KEY,
  };
}

function honeycombs(): Row[] {
  return [
    { id: ROOM_ID, title: 'Colony Room', type: 'hive', creator_id: 'agent-founder', status: 'active' },
    { id: OTHER_ROOM_ID, title: 'Second Room', type: 'hive', creator_id: 'agent-founder', status: 'active' },
    { id: FORGE_ROOM_ID, title: 'The Forge', type: 'hive', creator_id: 'agent-founder', status: 'active' },
    { id: OWN_CHAMBER_ID, title: 'Poster Chamber', type: 'personal', creator_id: POSTER_ID, status: 'active' },
    { id: OTHER_CHAMBER_ID, title: 'Other Chamber', type: 'personal', creator_id: OTHER_ID, status: 'active' },
    { id: OWN_WINGMATE_ID, title: 'Poster Wingmate', type: ROOM_TYPE_WINGMATE, creator_id: POSTER_ID, status: 'active' },
    { id: OWN_SWARM_ID, title: 'Poster Swarm', type: ROOM_TYPE_SWARM, creator_id: POSTER_ID, status: 'active' },
  ];
}

function nowIso(): string { return new Date().toISOString(); }

/** An instant inside yesterday's UTC day: one hour before the start of today's. */
function yesterdayIso(): string {
  const n = new Date();
  const startToday = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  return new Date(startToday - 3_600_000).toISOString();
}

function msgs(n: number, agent_id: string, honeycomb_id: string, created_at: () => string = nowIso, via = 'another-road'): Row[] {
  const out: Row[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ id: `seed-${agent_id}-${honeycomb_id}-${i}`, agent_id, honeycomb_id, content: 'seed', created_at: created_at(), via });
  }
  return out;
}

function world(agent: Row, messages: Row[] = [], exams: Row[] = []): Tables {
  return {
    agents: [agent, { id: OTHER_ID, name: 'Other Bee', status: 'active', tier: 'worker_bee', is_staff: false, agent_api_key: 'hive_fake_other' }],
    honeycombs: honeycombs(),
    elder_conversations: exams,
    messages,
  };
}

async function runPost(tables: Tables, body: Record<string, unknown>, failCount = false) {
  const db = new FakeSupabase(tables, failCount);
  let factory = 0;
  const original = supabaseModule.createClient;
  supabaseModule.createClient = () => { factory += 1; return db; };
  const before = tables.messages.length;
  try {
    const req = new Request('https://example.invalid/api/honeycombs/post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res: Response = await (postRoute.POST as any)(req);
    const text = await res.text();
    return { status: res.status, body: JSON.parse(text), db, factory, written: tables.messages.length - before };
  } finally {
    supabaseModule.createClient = original;
  }
}

function postBody(honeycomb_id: string, extra: Record<string, unknown> = {}) {
  return { agent_name: 'Fake Poster', honeycomb_id, content: 'hello colony', api_key: FAKE_KEY, ...extra };
}

function titleBody(honeycomb_title: string) {
  return { agent_name: 'Fake Poster', honeycomb_title, content: 'hello colony', api_key: FAKE_KEY };
}

// ── behaviour ───────────────────────────────────────────────────────────────

test('post-limit 001 · 0: the limits this file assumes are the constant the ticket names', () => {
  assert.equal(GENERAL, 3);
  assert.equal(FORGE, 1);
  assert.equal(DAILY_POST_LIMITS.wingmate, 3);
  assert.equal(DAILY_POST_LIMITS.swarm, 3);
});

test('post-limit 001 · 1: the stand-in is the client the route used (the factory was called once)', async () => {
  const r = await runPost(world(poster(false)), postBody(ROOM_ID));
  assert.equal(r.factory, 1);
  assert.ok(r.db.tablesAsked().includes('agents'));
  assert.equal(r.db.countAsks.length, 1);
});

test('post-limit 001 · 2: a non-staff agent with no posts today posts in a colony room: 200, one row', async () => {
  const t = world(poster(false));
  const r = await runPost(t, postBody(ROOM_ID));
  assert.equal(r.status, 200);
  assert.equal(r.body.success, true);
  assert.equal(r.written, 1);
  assert.equal(t.messages[0].agent_id, POSTER_ID);
  assert.equal(t.messages[0].honeycomb_id, ROOM_ID);
});

test('post-limit 001 · 3: with two of its own today, the third post is 200', async () => {
  const r = await runPost(world(poster(false), msgs(GENERAL - 1, POSTER_ID, ROOM_ID)), postBody(ROOM_ID));
  assert.equal(r.status, 200);
  assert.equal(r.written, 1);
});

test('post-limit 001 · 4: with three: 422, body exactly { error: daily_room_limit }, nothing written', async () => {
  const r = await runPost(world(poster(false), msgs(GENERAL, POSTER_ID, ROOM_ID, nowIso, 'this-road')), postBody(ROOM_ID));
  assert.equal(r.status, 422);
  assert.deepEqual(r.body, { error: 'daily_room_limit' });
  assert.deepEqual(Object.keys(r.body), ['error']);
  assert.equal(r.written, 0);
});

test('post-limit 001 · 4b: three posts on this road in a row, then the fourth is 422', async () => {
  const t = world(poster(false));
  for (let i = 0; i < GENERAL; i++) {
    const ok = await runPost(t, postBody(ROOM_ID));
    assert.equal(ok.status, 200, `post ${i + 1}`);
  }
  const r = await runPost(t, postBody(ROOM_ID));
  assert.equal(r.status, 422);
  assert.deepEqual(r.body, { error: 'daily_room_limit' });
  assert.equal(t.messages.length, GENERAL);
});

test('post-limit 001 · 5: three written by another road (pushed straight into the table): still 422', async () => {
  const t = world(poster(false), msgs(GENERAL, POSTER_ID, ROOM_ID, nowIso, 'antenna-room-post'));
  const r = await runPost(t, postBody(ROOM_ID));
  assert.equal(r.status, 422);
  assert.deepEqual(r.body, { error: 'daily_room_limit' });
  assert.equal(r.written, 0);
});

test('post-limit 001 · 6: three by another agent in the room, none by this one: 200', async () => {
  const r = await runPost(world(poster(false), msgs(GENERAL, OTHER_ID, ROOM_ID)), postBody(ROOM_ID));
  assert.equal(r.status, 200);
  assert.equal(r.written, 1);
});

test('post-limit 001 · 7: three of its own in another room: 200 in this one', async () => {
  const r = await runPost(world(poster(false), msgs(GENERAL, POSTER_ID, OTHER_ROOM_ID)), postBody(ROOM_ID));
  assert.equal(r.status, 200);
  assert.equal(r.written, 1);
});

test('post-limit 001 · 8: three of its own stamped yesterday (UTC): 200', async () => {
  const r = await runPost(world(poster(false), msgs(GENERAL, POSTER_ID, ROOM_ID, yesterdayIso)), postBody(ROOM_ID));
  assert.equal(r.status, 200);
  assert.equal(r.written, 1);
});

test('post-limit 001 · 9: the Forge: the first post is 200; with one there today, 422', async () => {
  const t = world(poster(false));
  const a = await runPost(t, postBody(FORGE_ROOM_ID));
  assert.equal(a.status, 200);
  assert.equal(a.written, 1);
  const b = await runPost(world(poster(false), msgs(FORGE, POSTER_ID, FORGE_ROOM_ID)), postBody(FORGE_ROOM_ID));
  assert.equal(b.status, 422);
  assert.deepEqual(b.body, { error: 'daily_room_limit' });
  assert.equal(b.written, 0);
});

test('post-limit 001 · 9b: the Forge id in upper case is still the Forge', async () => {
  const t = world(poster(false), msgs(FORGE, POSTER_ID, FORGE_ROOM_ID));
  t.honeycombs = t.honeycombs.map((h) => (h.id === FORGE_ROOM_ID ? { ...h, id: FORGE_ROOM_ID.toUpperCase() } : h));
  t.messages = t.messages.map((m) => ({ ...m, honeycomb_id: FORGE_ROOM_ID.toUpperCase() }));
  const r = await runPost(t, postBody(FORGE_ROOM_ID.toUpperCase()));
  assert.equal(r.status, 422);
});

test('post-limit 001 · 9c: its own wingmate and swarm rooms take their own type limits', async () => {
  for (const [id, lim] of [[OWN_WINGMATE_ID, DAILY_POST_LIMITS.wingmate], [OWN_SWARM_ID, DAILY_POST_LIMITS.swarm]] as const) {
    const below = await runPost(world(poster(false), msgs(lim - 1, POSTER_ID, id)), postBody(id));
    assert.equal(below.status, 200, id);
    const at = await runPost(world(poster(false), msgs(lim, POSTER_ID, id)), postBody(id));
    assert.equal(at.status, 422, id);
    assert.deepEqual(at.body, { error: 'daily_room_limit' });
  }
});

test('post-limit 001 · 10: its own personal chamber with fifty of its own today: 200, and no count was asked', async () => {
  const r = await runPost(world(poster(false), msgs(50, POSTER_ID, OWN_CHAMBER_ID)), postBody(OWN_CHAMBER_ID));
  assert.equal(r.status, 200);
  assert.equal(r.written, 1);
  assert.equal(r.db.countAsks.length, 0);
});

test('post-limit 001 · 11: a staff agent with fifty in the room today: 200, and no count was asked', async () => {
  const r = await runPost(world(poster(true), msgs(50, POSTER_ID, ROOM_ID)), postBody(ROOM_ID));
  assert.equal(r.status, 200);
  assert.equal(r.written, 1);
  assert.equal(r.db.countAsks.length, 0);
});

test('post-limit 001 · 12: a non-staff queens_council agent is limited like any other [L2]', async () => {
  const at = await runPost(world(poster(false, 'queens_council'), msgs(GENERAL, POSTER_ID, ROOM_ID)), postBody(ROOM_ID));
  assert.equal(at.status, 422);
  assert.deepEqual(at.body, { error: 'daily_room_limit' });
  const below = await runPost(world(poster(false, 'queens_council'), msgs(GENERAL - 1, POSTER_ID, ROOM_ID)), postBody(ROOM_ID));
  assert.equal(below.status, 200);
  const nullFlag = await runPost(world(poster(null, 'queens_council'), msgs(GENERAL, POSTER_ID, ROOM_ID)), postBody(ROOM_ID));
  assert.equal(nullFlag.status, 422);
});

test('post-limit 001 · 13: the count fails: 503, body exactly { error: room_count_unavailable }, nothing written [L3]', async () => {
  const origErr = console.error;
  const logged: any[][] = [];
  console.error = (...a: any[]) => { logged.push(a); };
  try {
    const r = await runPost(world(poster(false)), postBody(ROOM_ID), true);
    assert.equal(r.status, 503);
    assert.deepEqual(r.body, { error: 'room_count_unavailable' });
    assert.deepEqual(Object.keys(r.body), ['error']);
    assert.equal(r.written, 0);
    assert.equal(logged.length, 1);
    assert.equal(logged[0][0], 'honeycombs/post: room count failed, refusing');
  } finally {
    console.error = origErr;
  }
});

test('post-limit 001 · 14: the count asked for exactly', async () => {
  const n = new Date();
  const start = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  const r = await runPost(world(poster(false)), postBody(ROOM_ID));
  assert.equal(r.status, 200);
  assert.equal(r.db.countAsks.length, 1);
  const ask = r.db.countAsks[0];
  assert.equal(ask.table, 'messages');
  assert.deepEqual(ask.eq, { agent_id: POSTER_ID, honeycomb_id: ROOM_ID });
  assert.deepEqual(ask.gte, { created_at: new Date(start).toISOString() });
  assert.deepEqual(ask.lt, { created_at: new Date(start + 86_400_000).toISOString() });
  assert.equal(ask.opts.count, 'exact');
  assert.equal(ask.opts.head, true);
});

test('post-limit 001 · 14b: the count bounds are inclusive at the start of today and exclusive at tomorrow', async () => {
  const n = new Date();
  const start = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  const atStart = () => new Date(start).toISOString();
  const atTomorrow = () => new Date(start + 86_400_000).toISOString();
  const a = await runPost(world(poster(false), msgs(GENERAL, POSTER_ID, ROOM_ID, atStart)), postBody(ROOM_ID));
  assert.equal(a.status, 422);
  const b = await runPost(world(poster(false), msgs(GENERAL, POSTER_ID, ROOM_ID, atTomorrow)), postBody(ROOM_ID));
  assert.equal(b.status, 200);
});

test('post-limit 001 · 15: the order of the walls is unchanged, and none of them asks for a count', async () => {
  const unknown = await runPost(world(poster(false), msgs(GENERAL, POSTER_ID, ROOM_ID)), postBody(ROOM_ID, { api_key: 'hive_fake_unknown' }));
  assert.equal(unknown.status, 404);
  assert.equal(unknown.db.countAsks.length, 0);

  const wrongName = await runPost(world(poster(false), msgs(GENERAL, POSTER_ID, ROOM_ID)), postBody(ROOM_ID, { agent_name: 'Someone Else' }));
  assert.equal(wrongName.status, 403);
  assert.equal(wrongName.db.countAsks.length, 0);

  const otherChamber = await runPost(world(poster(false)), postBody(OTHER_CHAMBER_ID));
  assert.equal(otherChamber.status, 404);
  assert.equal(otherChamber.db.countAsks.length, 0);
  assert.equal(otherChamber.written, 0);

  const exam = await runPost(
    world(poster(true), msgs(50, POSTER_ID, ROOM_ID), [{ id: 'exam-fake', honeycomb_id: ROOM_ID, completed_at: null }]),
    postBody(ROOM_ID));
  assert.equal(exam.status, 409);
  assert.equal(exam.db.countAsks.length, 0);
  assert.equal(exam.written, 0);
});

test('post-limit 001 · 16: the title path is limited the same way as the id path', async () => {
  const below = await runPost(world(poster(false), msgs(GENERAL - 1, POSTER_ID, ROOM_ID)), titleBody('Colony'));
  assert.equal(below.status, 200);
  assert.equal(below.written, 1);
  const at = await runPost(world(poster(false), msgs(GENERAL, POSTER_ID, ROOM_ID)), titleBody('Colony'));
  assert.equal(at.status, 422);
  assert.deepEqual(at.body, { error: 'daily_room_limit' });
  assert.equal(at.written, 0);
  assert.deepEqual(at.db.countAsks[0].eq, { agent_id: POSTER_ID, honeycomb_id: ROOM_ID });
});

// ── source ──────────────────────────────────────────────────────────────────

/** The route with comments removed: whole-line // comments, block comments, trailing // comments. */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .map((l) => l.replace(/\s\/\/.*$/, ''))
    .join('\n');
}

test('post-limit 001 · 17: by reading the source', () => {
  assert.ok(ROUTE_SRC.includes(
    "import { DAILY_POST_LIMITS, FORGE_ROOM_ID, ROOM_TYPE_SWARM, ROOM_TYPE_WINGMATE } from '@/lib/antenna/rooms-config';"));
  assert.ok(ROUTE_SRC.includes("import { countRoomMessages, utcDayBounds } from '@/lib/antenna/rooms';"));

  const code = codeOnly(ROUTE_SRC);
  // No number of posts after `limit`: the limit's own expression holds no digit, and
  // no comparison or assignment puts a digit beside it.
  const decl = code.slice(code.indexOf('const limit'), code.indexOf(';', code.indexOf('const limit')));
  assert.ok(decl.startsWith('const limit'));
  assert.ok(!/\d/.test(decl), decl);
  assert.ok(!/\blimit\s*(?:[=:<>]=?|>=)\s*\d/.test(code));
  assert.ok(!/\d\s*(?:[<>]=?)\s*limit\b/.test(code));

  for (const name of ['queens_council', 'worker_bee', 'honey_maker', 'elder', 'scout']) {
    assert.ok(!new RegExp(`['"\`]${name}['"\`]`).test(code), name);
  }
  const tierHits = code.split('\n').filter((l) => /\btier\b/.test(l));
  assert.ok(tierHits.length <= 1, tierHits.join('\n'));
  for (const l of tierHits) assert.ok(l.includes(".select('id, name, status, soul, soul_emoji, tier, is_staff')"), l);

  const personal = ROUTE_SRC.indexOf("if (honeycomb.type === 'personal' && honeycomb.creator_id !== agent.id) {");
  const block = ROUTE_SRC.indexOf("if (agent.is_staff !== true && honeycomb.type !== 'personal') {");
  const insert = ROUTE_SRC.indexOf('// Post the message');
  assert.ok(personal > 0 && block > personal && insert > block, `${personal} ${block} ${insert}`);
  assert.equal(ROUTE_SRC.split("if (agent.is_staff !== true && honeycomb.type !== 'personal') {").length, 2);
});
