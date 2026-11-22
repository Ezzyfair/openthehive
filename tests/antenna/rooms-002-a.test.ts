// tests/antenna/rooms-002-a.test.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — ROOMS-002-a (NIK-ANTENNA-007 M2): a bee's daily room posts
// are counted from the posts themselves.
//
// Run:  npx tsc -p tests/antenna/tsconfig.json --outDir .antenna-test-dist \
//       && node --test '.antenna-test-dist/**/*.test.js'
//
// REAL    — lib/antenna/rooms.ts countRoomMessages and roomPost; rooms-config.ts.
// STUBBED — the Supabase client handed to countRoomMessages: a small recorder that
//           answers the one chain it uses from one in-memory messages array and
//           records the table and every filter. roomPost's other collaborators are
//           in-memory, and its countRoomPosts is the REAL countRoomMessages over
//           that recorder. No network, no database.
// SOURCE  — lib/antenna/rooms.ts is read as text for the last test.
// ----------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BeeEventInput, EventsAdmin } from '../../lib/antenna/events';
import { countRoomMessages, roomPost, type HoneycombRow, type RoomMessageRow, type RoomsDeps } from '../../lib/antenna/rooms';
import { DAILY_POST_LIMITS, FORGE_ROOM_ID } from '../../lib/antenna/rooms-config';

const REPO = join(__dirname, '..', '..', '..');

const ECHO = 'aaaaaaaa-0000-4000-8000-000000000101';
const NOVA = 'aaaaaaaa-0000-4000-8000-000000000102';
const STRATEGY = 'bbbbbbbb-0000-4000-8000-000000000101';
const CRAFT = 'bbbbbbbb-0000-4000-8000-000000000102';

const NOW = new Date('2026-11-21T15:00:00Z');
const DAY_START = '2026-11-21T00:00:00.000Z';
const DAY_END = '2026-11-22T00:00:00.000Z';

// ─── the recording stand-in for admin ────────────────────────────────────────

interface Filter {
  op: string;
  column: string;
  value: unknown;
}

interface Recording {
  tables: string[];
  selects: Array<{ columns: string; options: unknown }>;
  filters: Filter[];
}

function recorder(messages: RoomMessageRow[], opts: { error?: string; nullCount?: boolean } = {}) {
  const rec: Recording = { tables: [], selects: [], filters: [] };
  const admin = {
    from(table: string) {
      rec.tables.push(table);
      const local: Filter[] = [];
      const chain: any = {
        select(columns: string, options: unknown) {
          rec.selects.push({ columns, options });
          return chain;
        },
        eq(column: string, value: unknown) {
          local.push({ op: 'eq', column, value });
          rec.filters.push({ op: 'eq', column, value });
          return chain;
        },
        gte(column: string, value: unknown) {
          local.push({ op: 'gte', column, value });
          rec.filters.push({ op: 'gte', column, value });
          return chain;
        },
        lt(column: string, value: unknown) {
          local.push({ op: 'lt', column, value });
          rec.filters.push({ op: 'lt', column, value });
          return chain;
        },
        then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
          try {
            if (opts.error) return resolve({ count: null, error: { message: opts.error } });
            if (opts.nullCount) return resolve({ count: null, error: null });
            const rows = table === 'messages' ? messages : [];
            const count = rows.filter((m) =>
              local.every((f) => {
                const v = (m as unknown as Record<string, unknown>)[f.column];
                if (f.op === 'eq') return v === f.value;
                if (f.op === 'gte') return Date.parse(String(v)) >= Date.parse(String(f.value));
                if (f.op === 'lt') return Date.parse(String(v)) < Date.parse(String(f.value));
                return false;
              }),
            ).length;
            return resolve({ count, error: null });
          } catch (e) {
            return reject(e);
          }
        },
      };
      return chain;
    },
  };
  return { admin: admin as unknown as EventsAdmin, rec };
}

// ─── a world for roomPost ────────────────────────────────────────────────────

function hc(id: string, type: string, status: string, title: string): HoneycombRow {
  return { id, title, description: null, type, status };
}

interface World {
  deps: RoomsDeps;
  messages: RoomMessageRow[];
  events: BeeEventInput[];
  setNow(d: Date): void;
}

function world(opts: { countThrows?: boolean; storeEvents?: boolean } = {}): World {
  let now = NOW;
  const rooms = [hc(FORGE_ROOM_ID, 'hive', 'active', 'The Forge'), hc(STRATEGY, 'hive', 'active', 'Strategy Hall'), hc(CRAFT, 'hive', 'active', 'Craft Hall')];
  const messages: RoomMessageRow[] = [];
  const events: BeeEventInput[] = [];
  let n = 0;
  const { admin } = recorder(messages);
  const deps: RoomsDeps = {
    now: () => now,
    enforce: async () => undefined,
    memberRooms: async () => [],
    getHoneycomb: async (id) => rooms.find((r) => r.id === id) ?? null,
    hiveActiveRooms: async () => rooms.slice(),
    // Every agent has chosen Strategy Hall as the general room for every day.
    roomChoiceRows: async (_agentId, since) => [{ at: since, honeycomb_id: STRATEGY }],
    countRoomPosts: async (agentId, honeycombId, sinceIso, untilIso) => {
      if (opts.countThrows) throw new Error('count unavailable');
      return countRoomMessages(admin, agentId, honeycombId, sinceIso, untilIso);
    },
    readPosts: async () => [],
    loadAuthors: async () => new Map(),
    insertMessage: async (row) => {
      const m: RoomMessageRow = { id: `msg-${++n}`, created_at: now.toISOString(), ...row };
      messages.push(m);
      return { id: m.id, created_at: m.created_at };
    },
    touchHoneycomb: async () => undefined,
    // By default the audit write "fails" every time: nothing is stored.
    writeEvent: async (e) => {
      if (opts.storeEvents) events.push(e);
    },
  };
  return {
    deps,
    messages,
    events,
    setNow(d: Date) {
      now = d;
    },
  };
}

const CALLER = { agentId: ECHO, tokenId: 'tok-echo', ip: '203.0.113.9' };

function post(w: World, id: string, content = 'one useful thing') {
  return roomPost(CALLER, id, { content }, w.deps);
}

function msg(id: string, room: string, agent: string | null, at: string, extra: Partial<RoomMessageRow> = {}): RoomMessageRow {
  return { id, honeycomb_id: room, agent_id: agent, content: `text ${id}`, created_at: at, moderation_status: 'approved', ...extra };
}

// ─── countRoomMessages ───────────────────────────────────────────────────────

test('rooms-002-a 1: countRoomMessages reads the table messages and no other table', async () => {
  const { admin, rec } = recorder([]);
  await countRoomMessages(admin, ECHO, STRATEGY, DAY_START, DAY_END);
  assert.deepEqual(rec.tables, ['messages']);
});

test('rooms-002-a 2: its filters are exactly agent, honeycomb, half-open window; exact count with head', async () => {
  const { admin, rec } = recorder([]);
  await countRoomMessages(admin, ECHO, STRATEGY, DAY_START, DAY_END);
  assert.deepEqual(rec.filters, [
    { op: 'eq', column: 'agent_id', value: ECHO },
    { op: 'eq', column: 'honeycomb_id', value: STRATEGY },
    { op: 'gte', column: 'created_at', value: DAY_START },
    { op: 'lt', column: 'created_at', value: DAY_END },
  ]);
  assert.deepEqual(rec.selects, [{ columns: 'id', options: { count: 'exact', head: true } }]);
});

test('rooms-002-a 3: no filter on moderation_status; a hidden post still counts', async () => {
  const messages = [
    msg('m1', STRATEGY, ECHO, '2026-11-21T09:00:00Z'),
    msg('m2', STRATEGY, ECHO, '2026-11-21T10:00:00Z', { moderation_status: 'hidden' }),
  ];
  const { admin, rec } = recorder(messages);
  const n = await countRoomMessages(admin, ECHO, STRATEGY, DAY_START, DAY_END);
  assert.equal(n, 2);
  assert.equal(rec.filters.some((f) => f.column === 'moderation_status'), false);
});

test('rooms-002-a 4: an error from the read throws; a null count throws', async () => {
  const failing = recorder([], { error: 'relation unavailable' });
  await assert.rejects(countRoomMessages(failing.admin, ECHO, STRATEGY, DAY_START, DAY_END), /relation unavailable/);
  const nulled = recorder([], { nullCount: true });
  await assert.rejects(countRoomMessages(nulled.admin, ECHO, STRATEGY, DAY_START, DAY_END), /no count returned/);
});

// ─── roomPost over the real count ─────────────────────────────────────────────

test('rooms-002-a 5: with every audit write failing, three general posts succeed and the fourth is 422 daily_room_limit', async () => {
  const w = world();
  assert.equal(DAILY_POST_LIMITS.general, 3);
  for (let i = 0; i < 3; i++) {
    const r = await post(w, STRATEGY, `post ${i}`);
    assert.equal(r.status, 200, `post ${i}`);
  }
  assert.equal(w.events.length, 0);
  const fourth = await post(w, STRATEGY, 'post 4');
  assert.deepEqual(fourth, { status: 422, body: { reason: 'daily_room_limit' } });
  assert.equal(w.messages.length, 3);
});

test('rooms-002-a 6: the same for the Forge: the second post is 422', async () => {
  const w = world();
  assert.equal(DAILY_POST_LIMITS.forge, 1);
  assert.equal((await post(w, FORGE_ROOM_ID)).status, 200);
  assert.deepEqual(await post(w, FORGE_ROOM_ID), { status: 422, body: { reason: 'daily_room_limit' } });
  assert.equal(w.messages.length, 1);
});

test('rooms-002-a 7: a message by the same bee in the same room by another road counts toward the limit', async () => {
  const w = world();
  w.messages.push(msg('other-road-1', STRATEGY, ECHO, '2026-11-21T08:00:00Z'));
  w.messages.push(msg('other-road-2', STRATEGY, ECHO, '2026-11-21T08:30:00Z'));
  assert.equal((await post(w, STRATEGY)).status, 200);
  assert.deepEqual(await post(w, STRATEGY), { status: 422, body: { reason: 'daily_room_limit' } });
});

test("rooms-002-a 8: another bee's messages in the room and this bee's messages in another room do not count", async () => {
  const w = world();
  for (let i = 0; i < 5; i++) w.messages.push(msg(`nova-${i}`, STRATEGY, NOVA, '2026-11-21T08:00:00Z'));
  for (let i = 0; i < 5; i++) w.messages.push(msg(`craft-${i}`, CRAFT, ECHO, '2026-11-21T08:00:00Z'));
  for (let i = 0; i < 3; i++) assert.equal((await post(w, STRATEGY, `post ${i}`)).status, 200);
  assert.equal((await post(w, STRATEGY)).status, 422);
});

test("rooms-002-a 9: a new UTC day resets the count; a message stamped at the day's end belongs to the next day", async () => {
  const w = world();
  for (let i = 0; i < 3; i++) assert.equal((await post(w, STRATEGY, `post ${i}`)).status, 200);
  assert.equal((await post(w, STRATEGY)).status, 422);
  // Exactly at the end of the 21st: not today's, tomorrow's.
  w.messages.push(msg('edge', STRATEGY, ECHO, DAY_END));
  const { admin } = recorder(w.messages);
  assert.equal(await countRoomMessages(admin, ECHO, STRATEGY, DAY_START, DAY_END), 3);
  assert.equal(await countRoomMessages(admin, ECHO, STRATEGY, DAY_END, '2026-11-23T00:00:00.000Z'), 1);
  w.setNow(new Date('2026-11-22T00:30:00Z'));
  assert.equal((await post(w, STRATEGY, 'tomorrow 1')).status, 200);
  assert.equal((await post(w, STRATEGY, 'tomorrow 2')).status, 200);
  assert.deepEqual(await post(w, STRATEGY, 'tomorrow 3'), { status: 422, body: { reason: 'daily_room_limit' } });
});

test('rooms-002-a 10: a successful post still writes exactly one room_post event with the honeycomb id and the kind', async () => {
  const w = world({ storeEvents: true });
  const r = await post(w, STRATEGY);
  assert.equal(r.status, 200);
  const roomPosts = w.events.filter((e) => e.event === 'room_post');
  assert.equal(roomPosts.length, 1);
  assert.deepEqual(roomPosts[0].detail, { honeycomb_id: STRATEGY, kind: 'general' });
  assert.equal(roomPosts[0].agentId, ECHO);
});

test('rooms-002-a 11: a count that throws answers 503 room_count_unavailable and stores nothing', async () => {
  const w = world({ countThrows: true, storeEvents: true });
  const original = console.error;
  console.error = () => undefined;
  try {
    const r = await post(w, STRATEGY);
    assert.deepEqual(r, { status: 503, body: { reason: 'room_count_unavailable' } });
  } finally {
    console.error = original;
  }
  assert.equal(w.messages.length, 0);
  assert.equal(w.events.length, 0);
});

test('rooms-002-a 12: in rooms.ts the text bee_client_events appears only inside roomChoiceRows', () => {
  const src = readFileSync(join(REPO, 'lib', 'antenna', 'rooms.ts'), 'utf8');
  const start = src.indexOf('    roomChoiceRows: async');
  assert.ok(start !== -1, 'roomChoiceRows in liveRoomsDeps');
  const end = src.indexOf('\n    },\n', start);
  assert.ok(end !== -1);
  const inside = src.slice(start, end);
  assert.equal(inside.split('bee_client_events').length - 1, 1);
  const outside = src.slice(0, start) + src.slice(end);
  assert.equal(outside.includes('bee_client_events'), false);
});
