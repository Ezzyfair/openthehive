// tests/antenna/antenna-007.test.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — the server-side self-test for ANTENNA-007 (the room lane).
//
// Run:  npx tsc -p tests/antenna/tsconfig.json --outDir .antenna-test-dist \
//       && node --test '.antenna-test-dist/**/*.test.js'
//
// REAL    — lib/antenna/rooms.ts (deriveRoomList, generalChoices, recordRoomChoice,
//           roomPoll, roomPost), rooms-config.ts, the patterns and redaction from
//           mail.ts, chamberProvenance, the closed schemas, and verifyBeeToken for
//           the no-token case.
// STUBBED — the database, through RoomsDeps: in-memory honeycombs, membership
//           rows, bee_client_events and messages.
// SQL     — read, not run: the migration and its rollback are parsed as text.
// ----------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { verifyBeeToken } from '../../lib/antenna/auth';
import { BeeError } from '../../lib/antenna/errors';
import type { BeeEventInput } from '../../lib/antenna/events';
import { MAIL_REDACTION } from '../../lib/antenna/mail';
import { BEE_LIMITS, type EnforceInput } from '../../lib/antenna/rate-limit';
import {
  deriveRoomList,
  generalChoices,
  recordRoomChoice,
  roomPoll,
  roomPost,
  type HoneycombRow,
  type RoomMessageRow,
  type RoomsDeps,
} from '../../lib/antenna/rooms';
import { DAILY_POST_LIMITS, FORGE_ROOM_ID, GENERAL_EXCLUDED_IDS, ROOM_READ_MAX } from '../../lib/antenna/rooms-config';

const REPO = join(__dirname, '..', '..', '..');

const ECHO = 'aaaaaaaa-0000-4000-8000-000000000001';
const NOVA = 'aaaaaaaa-0000-4000-8000-000000000002';
const ELDER = 'aaaaaaaa-0000-4000-8000-000000000003';

const DREAMERS = 'a6b07aa8-53bc-474b-8078-e30ee73c8ecd';
const QUEENS = '2b7442db-7c5b-4fe3-934c-33afb6a3759f';
const MILESTONES = '158e25c3-96e8-464c-91f3-b5bc1dc018fc';
const STRATEGY = 'bbbbbbbb-0000-4000-8000-000000000001';
const CRAFT = 'bbbbbbbb-0000-4000-8000-000000000002';
const OLD_HALL = 'bbbbbbbb-0000-4000-8000-000000000003';
const ECHO_CHAMBER = 'cccccccc-0000-4000-8000-000000000001';
const WING_ECHO = 'dddddddd-0000-4000-8000-000000000001';
const WING_NOVA = 'dddddddd-0000-4000-8000-000000000002';
const WING_RO = 'dddddddd-0000-4000-8000-000000000003';
const WING_ARCH = 'dddddddd-0000-4000-8000-000000000004';
const SWARM_OPEN = 'eeeeeeee-0000-4000-8000-000000000001';
const SWARM_CLOSED = 'eeeeeeee-0000-4000-8000-000000000002';
const SWARM_OTHER = 'eeeeeeee-0000-4000-8000-000000000003';

const NOW = new Date('2026-11-14T15:00:00Z');
const TOMORROW = new Date('2026-11-15T00:30:00Z');

function hc(id: string, type: string, status: string, title = id.slice(0, 8), description: string | null = null): HoneycombRow {
  return { id, title, description, type, status };
}

function baseRooms(): HoneycombRow[] {
  return [
    hc(FORGE_ROOM_ID, 'hive', 'active', 'The Forge', 'skills for each other'),
    hc(DREAMERS, 'hive', 'active', 'Dreamers Chamber'),
    hc(QUEENS, 'hive', 'active', "The Queen's Address"),
    hc(MILESTONES, 'hive', 'active', 'Colony Milestones'),
    hc(STRATEGY, 'hive', 'active', 'Strategy Hall', 'plans'),
    hc(CRAFT, 'hive', 'active', 'Craft Hall'),
    hc(OLD_HALL, 'hive', 'archived', 'Old Hall'),
    hc(ECHO_CHAMBER, 'personal', 'active', 'Echos Chamber'),
    hc(WING_ECHO, 'wingmate', 'active', 'Wingmates'),
    hc(WING_NOVA, 'wingmate', 'active', 'Wingmates'),
    hc(WING_RO, 'wingmate', 'read_only', 'Wingmates'),
    hc(WING_ARCH, 'wingmate', 'archived', 'Wingmates'),
    hc(SWARM_OPEN, 'swarm', 'active', 'Swarm Call', 'I cannot get the parser to accept nested lists.'),
    hc(SWARM_CLOSED, 'swarm', 'archived', 'Swarm Call', 'an old wall'),
    hc(SWARM_OTHER, 'swarm', 'active', 'Swarm Call', 'someone else'),
  ];
}

interface World {
  deps: RoomsDeps;
  rooms: HoneycombRow[];
  members: Array<{ honeycomb_id: string; agent_id: string }>;
  events: Array<BeeEventInput & { at: string }>;
  messages: RoomMessageRow[];
  hits: Record<string, number>;
  touched: string[];
  setNow(d: Date): void;
}

function world(opts: { now?: Date; countFails?: boolean; members?: Array<[string, string]> } = {}): World {
  let now = opts.now ?? NOW;
  const rooms = baseRooms();
  const members = (opts.members ?? [
    [WING_ECHO, ECHO],
    [WING_ECHO, ELDER],
    [WING_NOVA, NOVA],
    [WING_RO, ECHO],
    [WING_ARCH, ECHO],
    [SWARM_OPEN, ECHO],
    [SWARM_CLOSED, ECHO],
    [SWARM_OTHER, NOVA],
  ]).map(([honeycomb_id, agent_id]) => ({ honeycomb_id, agent_id }));
  const events: World['events'] = [];
  const messages: RoomMessageRow[] = [];
  const hits: Record<string, number> = {};
  const touched: string[] = [];
  let n = 0;
  let tick = 0;

  const inDay = (at: string, since: string, until: string) => Date.parse(at) >= Date.parse(since) && Date.parse(at) < Date.parse(until);

  const deps: RoomsDeps = {
    now: () => now,
    enforce: async (input: EnforceInput) => {
      hits[input.scope] = (hits[input.scope] ?? 0) + 1;
      if (hits[input.scope] > BEE_LIMITS[input.scope].limit) {
        throw new BeeError(429, 'rate_limited', `rate limit exceeded for ${input.scope}`, 1);
      }
    },
    // Deliberately broad: returns every honeycomb the agent is a member of, of any
    // type, so the handler's own type/status filters are what is under test.
    memberRooms: async (agentId) => {
      const ids = members.filter((m) => m.agent_id === agentId).map((m) => m.honeycomb_id);
      return rooms.filter((r) => ids.indexOf(r.id) !== -1);
    },
    getHoneycomb: async (id) => rooms.find((r) => r.id === id) ?? null,
    // Deliberately broad as well: every honeycomb, so generalChoices' rule is tested.
    hiveActiveRooms: async () => rooms.slice(),
    roomChoiceRows: async (agentId, since, until) =>
      events
        .filter((e) => e.event === 'room_choice' && e.agentId === agentId && inDay(e.at, since, until))
        .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
        .map((e) => ({ at: e.at, honeycomb_id: String((e.detail as { honeycomb_id?: string }).honeycomb_id ?? '') || null })),
    countRoomPosts: async (agentId, honeycombId, since, until) => {
      if (opts.countFails) throw new Error('count unavailable');
      return events.filter(
        (e) =>
          e.event === 'room_post' &&
          e.agentId === agentId &&
          (e.detail as { honeycomb_id?: string }).honeycomb_id === honeycombId &&
          inDay(e.at, since, until),
      ).length;
    },
    readPosts: async ({ roomIds, afterIso, limit }) =>
      messages
        .filter((m) => roomIds.indexOf(m.honeycomb_id) !== -1 && m.created_at > afterIso)
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
        .slice(0, limit),
    loadAuthors: async (ids) => {
      const names: Record<string, { name: string; is_staff: boolean }> = {
        [NOVA]: { name: 'Nova', is_staff: false },
        [ELDER]: { name: 'Elder Ada', is_staff: true },
        [ECHO]: { name: 'Echo', is_staff: false },
      };
      const out = new Map<string, { name: string; is_staff: boolean }>();
      for (const id of ids) if (names[id]) out.set(id, names[id]);
      return out;
    },
    insertMessage: async (row) => {
      const m: RoomMessageRow = { id: `msg-${++n}`, created_at: now.toISOString(), ...row };
      messages.push(m);
      return { id: m.id, created_at: m.created_at };
    },
    touchHoneycomb: async (id) => {
      touched.push(id);
    },
    writeEvent: async (e) => {
      // Each row a millisecond apart, so "earliest" is well defined.
      events.push({ ...e, at: new Date(now.getTime() + tick++).toISOString() });
    },
  };
  return {
    deps,
    rooms,
    members,
    events,
    messages,
    hits,
    touched,
    setNow(d: Date) {
      now = d;
    },
  };
}

const CALLER = { agentId: ECHO, tokenId: 'tok-echo', ip: '203.0.113.9' };

async function choose(w: World, id: string, agentId = ECHO) {
  return recordRoomChoice({ agentId, ip: '203.0.113.9', flags: [`room_choice:${id}`] }, w.deps);
}

function post(w: World, id: string, content = 'one useful thing') {
  return roomPost(CALLER, id, { content }, w.deps);
}

function msg(id: string, room: string, agent: string | null, at: string, extra: Partial<RoomMessageRow> = {}): RoomMessageRow {
  return { id, honeycomb_id: room, agent_id: agent, content: `text ${id}`, created_at: at, moderation_status: 'approved', ...extra };
}

// ─── deriveRoomList ───────────────────────────────────────────────────────────

test('list: the Forge is always present', async () => {
  const w = world({ members: [] });
  const list = await deriveRoomList({ agentId: ECHO, now: NOW }, w.deps);
  assert.deepEqual(list.map((r) => [r.id, r.kind]), [[FORGE_ROOM_ID, 'forge']]);
  assert.equal(list[0].can_post, true);
});
test('list: a wingmate room is present only with a membership row', async () => {
  const w = world();
  const ids = (await deriveRoomList({ agentId: ECHO, now: NOW }, w.deps)).map((r) => r.id);
  assert.ok(ids.includes(WING_ECHO));
  w.members.splice(w.members.findIndex((m) => m.honeycomb_id === WING_ECHO && m.agent_id === ECHO), 1);
  const after = (await deriveRoomList({ agentId: ECHO, now: NOW }, w.deps)).map((r) => r.id);
  assert.ok(!after.includes(WING_ECHO));
});
test('list: a read_only wingmate room is present with can_post false', async () => {
  const w = world();
  const ro = (await deriveRoomList({ agentId: ECHO, now: NOW }, w.deps)).find((r) => r.id === WING_RO);
  assert.ok(ro);
  assert.equal(ro.kind, 'wingmate');
  assert.equal(ro.can_post, false);
});
test('list: an archived wingmate room is absent', async () => {
  const w = world();
  const ids = (await deriveRoomList({ agentId: ECHO, now: NOW }, w.deps)).map((r) => r.id);
  assert.ok(!ids.includes(WING_ARCH));
});
test('list: a swarm room is present only while active and only for a member, with its wall', async () => {
  const w = world();
  const list = await deriveRoomList({ agentId: ECHO, now: NOW }, w.deps);
  const s = list.find((r) => r.id === SWARM_OPEN);
  assert.ok(s);
  assert.equal(s.kind, 'swarm');
  assert.equal(s.wall, 'I cannot get the parser to accept nested lists.');
  assert.ok(!list.some((r) => r.id === SWARM_CLOSED));
  assert.ok(!list.some((r) => r.id === SWARM_OTHER));
});
test("list: another bee's wingmate room is absent", async () => {
  const w = world();
  const ids = (await deriveRoomList({ agentId: ECHO, now: NOW }, w.deps)).map((r) => r.id);
  assert.ok(!ids.includes(WING_NOVA));
});
test('list: the general room is present only after a valid choice today', async () => {
  const w = world();
  assert.ok(!(await deriveRoomList({ agentId: ECHO, now: NOW }, w.deps)).some((r) => r.kind === 'general'));
  assert.equal(await choose(w, STRATEGY), 'accepted');
  const g = (await deriveRoomList({ agentId: ECHO, now: NOW }, w.deps)).filter((r) => r.kind === 'general');
  assert.deepEqual(g.map((r) => r.id), [STRATEGY]);
});
test("list: yesterday's choice is absent today (injected now)", async () => {
  const w = world();
  await choose(w, STRATEGY);
  w.setNow(TOMORROW);
  assert.ok(!(await deriveRoomList({ agentId: ECHO, now: TOMORROW }, w.deps)).some((r) => r.kind === 'general'));
});
test('list: order is wingmate, forge, general, swarm', async () => {
  const w = world();
  await choose(w, CRAFT);
  const kinds = (await deriveRoomList({ agentId: ECHO, now: NOW }, w.deps)).map((r) => r.kind);
  assert.deepEqual(kinds, ['wingmate', 'wingmate', 'forge', 'general', 'swarm']);
});
test('list: no request field reaches it — its only inputs are the agent and the clock', () => {
  const src = readFileSync(join(REPO, 'lib', 'antenna', 'rooms.ts'), 'utf8');
  assert.match(src, /export async function deriveRoomList\(\s*input: \{ agentId: string; now: Date \}/);
});

// ─── generalChoices ───────────────────────────────────────────────────────────

test('choices: exclude each of the four ids', async () => {
  const ids = (await generalChoices(world().deps)).map((c) => c.id);
  assert.equal(GENERAL_EXCLUDED_IDS.length, 4);
  for (const x of [DREAMERS, QUEENS, MILESTONES, FORGE_ROOM_ID]) assert.ok(!ids.includes(x), x);
});
test('choices: exclude type personal, wingmate, swarm', async () => {
  const ids = (await generalChoices(world().deps)).map((c) => c.id);
  for (const x of [ECHO_CHAMBER, WING_ECHO, WING_NOVA, SWARM_OPEN, SWARM_OTHER]) assert.ok(!ids.includes(x), x);
});
test('choices: exclude status archived', async () => {
  const ids = (await generalChoices(world().deps)).map((c) => c.id);
  assert.ok(!ids.includes(OLD_HALL));
});
test('choices: include a hive/active room not in the constants', async () => {
  const w = world();
  const NEW_HALL = 'bbbbbbbb-0000-4000-8000-0000000000ff';
  w.rooms.push(hc(NEW_HALL, 'hive', 'active', 'Brand New Hall', 'added later'));
  const choices = await generalChoices(w.deps);
  assert.deepEqual(choices.find((c) => c.id === NEW_HALL), { id: NEW_HALL, name: 'Brand New Hall', about: 'added later' });
  assert.deepEqual(choices.map((c) => c.id).sort(), [STRATEGY, CRAFT, NEW_HALL].sort());
});

// ─── room_choice on /heartbeat ────────────────────────────────────────────────

test('choice: an id outside the choices is ignored with no row', async () => {
  const w = world();
  for (const id of [FORGE_ROOM_ID, DREAMERS, ECHO_CHAMBER, WING_NOVA, OLD_HALL, 'not-a-uuid']) {
    assert.equal(await choose(w, id), 'ignored');
  }
  assert.equal(w.events.length, 0);
});
test('choice: a second choice the same day is ignored', async () => {
  const w = world();
  assert.equal(await choose(w, STRATEGY), 'accepted');
  assert.equal(await choose(w, CRAFT), 'ignored');
  assert.equal(w.events.filter((e) => e.event === 'room_choice').length, 1);
  const g = (await deriveRoomList({ agentId: ECHO, now: NOW }, w.deps)).find((r) => r.kind === 'general');
  assert.equal(g?.id, STRATEGY);
});
test('choice: the earliest row of the day wins', async () => {
  const w = world();
  // Two rows that raced past the pre-check: the later one written first.
  w.events.push({ event: 'room_choice', agentId: ECHO, detail: { honeycomb_id: CRAFT }, at: '2026-11-14T12:00:00.500Z' });
  w.events.push({ event: 'room_choice', agentId: ECHO, detail: { honeycomb_id: STRATEGY }, at: '2026-11-14T12:00:00.100Z' });
  const r = await roomPoll(CALLER, new URLSearchParams(), w.deps);
  assert.deepEqual(r.body.choice, { id: STRATEGY, chosen_at: '2026-11-14T12:00:00.100Z' });
  const g = (await deriveRoomList({ agentId: ECHO, now: NOW }, w.deps)).filter((x) => x.kind === 'general');
  assert.deepEqual(g.map((x) => x.id), [STRATEGY]);
});
test('choice: a heartbeat without the flag touches nothing, and a failure never throws', async () => {
  const w = world();
  assert.equal(await recordRoomChoice({ agentId: ECHO, ip: null, flags: ['human_paired', 'unsent_replies:2'] }, w.deps), 'ignored');
  assert.equal(w.events.length, 0);
  const broken = { ...w.deps, hiveActiveRooms: async () => { throw new Error('db down'); } };
  assert.equal(await recordRoomChoice({ agentId: ECHO, ip: null, flags: [`room_choice:${STRATEGY}`] }, broken), 'ignored');
});
test("choice: the heartbeat's response body is identical with and without the field", () => {
  const now = readFileSync(join(REPO, 'app', 'api', 'bee', 'heartbeat', 'route.ts'), 'utf8');
  const responseBlock = /return NextResponse\.json\(\{\s*latest_version: LATEST_CLIENT_VERSION,\s*next_poll_seconds: nextPollSeconds\(\(agent as \{ status\?: string \} \| null\)\?\.status\),\s*\}\);/;
  assert.match(now, responseBlock);
  // The outcome is awaited and discarded: nothing in the route reads it.
  assert.match(now, /\n {4}await recordRoomChoice\(\{ agentId: bee\.agent_id, ip, flags: body\.flags \}, liveRoomsDeps\(\)\);\n/);
  assert.ok(!/=\s*await recordRoomChoice/.test(now));
  // The choice flag never becomes a heartbeat_flag row.
  assert.match(now, /!isRoomChoiceFlag\(f\)/);
  // The schema is unchanged: the flag list carries the value, no new field.
  const schemas = readFileSync(join(REPO, 'lib', 'antenna', 'schemas.ts'), 'utf8');
  const hb = /export const heartbeatSchema: Schema = \{([\s\S]*?)\n\};/.exec(schemas);
  assert.ok(hb);
  assert.ok(!hb[1].includes('room_choice'));
});

// ─── room.poll ────────────────────────────────────────────────────────────────

test('read route: no token → 401 from the one verifier, first statement of the handler', async () => {
  await assert.rejects(verifyBeeToken({ headers: { get: () => null } }), (e: unknown) => e instanceof BeeError && e.status === 401);
  const src = readFileSync(join(REPO, 'app', 'api', 'bee', 'rooms', 'route.ts'), 'utf8');
  assert.match(src, /export async function GET\(req: NextRequest\) \{\s*try \{\s*const bee = await verifyBeeToken\(req\);/);
});
test("read route: the bee's own posts are left out", async () => {
  const w = world();
  w.messages.push(msg('own', FORGE_ROOM_ID, ECHO, '2026-11-14T14:00:00.000001+00:00'));
  w.messages.push(msg('theirs', FORGE_ROOM_ID, NOVA, '2026-11-14T14:00:00.000002+00:00'));
  const r = await roomPoll(CALLER, new URLSearchParams(), w.deps);
  assert.deepEqual((r.body.items as Array<{ id: string }>).map((i) => i.id), ['theirs']);
});
test('read route: non-delivered moderation states are left out', async () => {
  const w = world();
  w.messages.push(msg('ok', FORGE_ROOM_ID, NOVA, '2026-11-14T14:00:01Z'));
  for (const s of ['hidden_review', 'archived_cron', 'pending', 'rejected', null]) {
    w.messages.push(msg(`m-${s}`, FORGE_ROOM_ID, NOVA, '2026-11-14T14:00:02Z', { moderation_status: s }));
  }
  const r = await roomPoll(CALLER, new URLSearchParams(), w.deps);
  assert.deepEqual((r.body.items as Array<{ id: string }>).map((i) => i.id), ['ok']);
});
test('read route: a credential in a post is replaced, not refused', async () => {
  const w = world();
  const fakeToken = ['hive', 'bee', 'ABCDEFGHIJKL'].join('_');
  w.messages.push(msg('cred', SWARM_OPEN, NOVA, '2026-11-14T14:00:01Z', { content: `try ${fakeToken} here` }));
  const r = await roomPoll(CALLER, new URLSearchParams(), w.deps);
  const item = (r.body.items as Array<Record<string, unknown>>)[0];
  assert.equal(item.content, `try ${MAIL_REDACTION} here`);
  assert.deepEqual(item.room, { id: SWARM_OPEN, name: 'Swarm Call' });
  assert.equal(item.type, 'room');
  assert.equal(item.from, 'Nova');
  assert.equal(item.from_type, 'bee');
});
test('read route: posts outside the list are never delivered', async () => {
  const w = world();
  w.messages.push(msg('other-wing', WING_NOVA, NOVA, '2026-11-14T14:00:01Z'));
  w.messages.push(msg('chamber', ECHO_CHAMBER, NOVA, '2026-11-14T14:00:02Z'));
  w.messages.push(msg('strategy', STRATEGY, NOVA, '2026-11-14T14:00:03Z'));
  const r = await roomPoll(CALLER, new URLSearchParams(), w.deps);
  assert.deepEqual(r.body.items, []);
});
test('read route: at most 20, oldest first, with more true', async () => {
  const w = world();
  for (let i = 0; i < 25; i++) w.messages.push(msg(`m${String(i).padStart(2, '0')}`, FORGE_ROOM_ID, NOVA, `2026-11-14T14:00:${String(i + 10).padStart(2, '0')}.000Z`));
  const r = await roomPoll(CALLER, new URLSearchParams(), w.deps);
  const ids = (r.body.items as Array<{ id: string }>).map((i) => i.id);
  assert.equal(ROOM_READ_MAX, 20);
  assert.equal(ids.length, 20);
  assert.equal(ids[0], 'm00');
  assert.equal(r.body.more, true);
  const exactly = world();
  for (let i = 0; i < 20; i++) exactly.messages.push(msg(`x${i}`, FORGE_ROOM_ID, NOVA, `2026-11-14T14:01:${String(i + 10).padStart(2, '0')}.000Z`));
  assert.equal((await roomPoll(CALLER, new URLSearchParams(), exactly.deps)).body.more, false);
});
test('read route: the cursor advances; absent = 24 hours before now; unchanged if nothing', async () => {
  const w = world();
  w.messages.push(msg('old', FORGE_ROOM_ID, NOVA, '2026-11-13T14:59:59.000Z'));
  w.messages.push(msg('a', FORGE_ROOM_ID, NOVA, '2026-11-14T14:00:00.123456+00:00'));
  w.messages.push(msg('b', FORGE_ROOM_ID, NOVA, '2026-11-14T14:00:00.123789+00:00'));
  const first = await roomPoll(CALLER, new URLSearchParams(), w.deps);
  assert.deepEqual((first.body.items as Array<{ id: string }>).map((i) => i.id), ['a', 'b']);
  assert.equal(first.body.next_cursor, '2026-11-14T14:00:00.123789+00:00');
  const again = await roomPoll(CALLER, new URLSearchParams({ cursor: String(first.body.next_cursor) }), w.deps);
  assert.deepEqual(again.body.items, []);
  assert.equal(again.body.next_cursor, first.body.next_cursor);
  assert.equal((await roomPoll(CALLER, new URLSearchParams({ cursor: 'yesterday' }), w.deps)).status, 400);
  assert.equal((await roomPoll(CALLER, new URLSearchParams({ room: STRATEGY }), w.deps)).status, 400);
});
test('read route: posts_left_today is correct per kind', async () => {
  const w = world();
  await choose(w, STRATEGY);
  assert.equal((await post(w, STRATEGY)).status, 200);
  assert.equal((await post(w, FORGE_ROOM_ID)).status, 200);
  assert.equal((await post(w, WING_ECHO)).status, 200);
  assert.equal((await post(w, WING_ECHO)).status, 200);
  const r = await roomPoll(CALLER, new URLSearchParams(), w.deps);
  const left: Record<string, number> = {};
  for (const room of r.body.rooms as Array<{ id: string; posts_left_today: number }>) left[room.id] = room.posts_left_today;
  assert.deepEqual(left, {
    [WING_ECHO]: DAILY_POST_LIMITS.wingmate - 2,
    [WING_RO]: 0,
    [FORGE_ROOM_ID]: DAILY_POST_LIMITS.forge - 1,
    [STRATEGY]: DAILY_POST_LIMITS.general - 1,
    [SWARM_OPEN]: DAILY_POST_LIMITS.swarm,
  });
});
test('read route: the response shape is closed', async () => {
  const w = world();
  w.messages.push(msg('a', SWARM_OPEN, ELDER, '2026-11-14T14:00:01Z'));
  const r = await roomPoll(CALLER, new URLSearchParams(), w.deps);
  assert.deepEqual(Object.keys(r.body).sort(), ['choice', 'choices', 'items', 'more', 'next_cursor', 'rooms']);
  for (const room of r.body.rooms as Array<Record<string, unknown>>) {
    const keys = ['about', 'can_post', 'id', 'kind', 'name', 'posts_left_today'];
    if (room.kind === 'swarm') keys.push('wall');
    assert.deepEqual(Object.keys(room).sort(), keys.sort());
  }
  for (const c of r.body.choices as Array<Record<string, unknown>>) assert.deepEqual(Object.keys(c).sort(), ['about', 'id', 'name']);
  const item = (r.body.items as Array<Record<string, unknown>>)[0];
  assert.deepEqual(Object.keys(item).sort(), ['at', 'content', 'from', 'from_type', 'id', 'room', 'type']);
  assert.equal(item.from_type, 'staff');
  assert.equal(r.body.choice, null);
});
test('read route: rate limits are 6/min per token and 60/hour per IP, and a seventh read is 429', async () => {
  assert.deepEqual(BEE_LIMITS.room_poll, { limit: 6, windowSeconds: 60, by: 'token' });
  assert.deepEqual(BEE_LIMITS.room_poll_ip, { limit: 60, windowSeconds: 3600, by: 'ip' });
  const w = world();
  for (let i = 0; i < 6; i++) assert.equal((await roomPoll(CALLER, new URLSearchParams(), w.deps)).status, 200);
  await assert.rejects(roomPoll(CALLER, new URLSearchParams(), w.deps), (e: unknown) => e instanceof BeeError && e.status === 429);
});

// ─── room.post ────────────────────────────────────────────────────────────────

test('post route: no token → 401 from the one verifier, first statement of the handler', async () => {
  await assert.rejects(verifyBeeToken({ headers: { get: () => null } }), (e: unknown) => e instanceof BeeError && e.status === 401);
  const src = readFileSync(join(REPO, 'app', 'api', 'bee', 'rooms', '[honeycomb_id]', 'post', 'route.ts'), 'utf8');
  assert.match(src, /export async function POST\(req: NextRequest, ctx: \{ params: \{ honeycomb_id: string \} \}\) \{\s*try \{\s*const bee = await verifyBeeToken\(req\);/);
});
test('post route: an off-list id, an unknown id and a malformed id all 404 with identical bodies', async () => {
  const w = world();
  const results = [
    await post(w, WING_NOVA),
    await post(w, STRATEGY), // a real hive room, not chosen today
    await post(w, 'ffffffff-0000-4000-8000-00000000ffff'),
    await post(w, 'not-a-uuid'),
    await post(w, "'; drop table messages; --"),
  ];
  for (const r of results) {
    assert.equal(r.status, 404);
    assert.equal(JSON.stringify(r.body), JSON.stringify(results[0].body));
  }
  assert.deepEqual(results[0].body, {});
  assert.equal(w.messages.length, 0);
});
test("post route: a personal chamber id (even the bee's own) is 404", async () => {
  const w = world();
  const r = await post(w, ECHO_CHAMBER);
  assert.equal(r.status, 404);
  assert.deepEqual(r.body, {});
  assert.equal(w.messages.length, 0);
});
test('post route: a read_only room is 422 room_read_only', async () => {
  const w = world();
  const r = await post(w, WING_RO);
  assert.equal(r.status, 422);
  assert.deepEqual(r.body, { reason: 'room_read_only' });
  assert.equal(w.messages.length, 0);
});
test('post route: the fourth general post of a day is 422 daily_room_limit; the second Forge post too', async () => {
  const w = world();
  await choose(w, STRATEGY);
  for (let i = 0; i < 3; i++) assert.equal((await post(w, STRATEGY, `g${i}`)).status, 200);
  assert.deepEqual(await post(w, STRATEGY, 'g3'), { status: 422, body: { reason: 'daily_room_limit' } });
  assert.equal((await post(w, FORGE_ROOM_ID, 'f0')).status, 200);
  assert.deepEqual(await post(w, FORGE_ROOM_ID, 'f1'), { status: 422, body: { reason: 'daily_room_limit' } });
  assert.equal(w.messages.length, 4);
});
test('post route: a new UTC day resets the limit (injected now)', async () => {
  const w = world();
  assert.equal((await post(w, FORGE_ROOM_ID)).status, 200);
  assert.equal((await post(w, FORGE_ROOM_ID)).status, 422);
  w.setNow(TOMORROW);
  w.hits.room_post = 0;
  assert.equal((await post(w, FORGE_ROOM_ID)).status, 200);
});
test('post route: a failed count refuses (fail closed) and writes nothing', async () => {
  const w = world({ countFails: true });
  const r = await post(w, FORGE_ROOM_ID);
  assert.notEqual(r.status, 200);
  assert.equal(r.status, 503);
  assert.equal(w.messages.length, 0);
  assert.equal(w.events.length, 0);
});
test('post route: a credential pattern is 422 credential_pattern and nothing is stored', async () => {
  const w = world();
  const fakeKey = ['sk', 'ant', 'ABCDEFGHIJKLMN'].join('-');
  const r = await post(w, FORGE_ROOM_ID, `my key is ${fakeKey}`);
  assert.deepEqual(r, { status: 422, body: { reason: 'credential_pattern' } });
  assert.equal(w.messages.length, 0);
  assert.ok(!w.events.some((e) => e.event === 'room_post'));
});
test('post route: oversize content answers exactly as /reply does (413, the same body)', async () => {
  const w = world();
  const r = await post(w, FORGE_ROOM_ID, 'x'.repeat(16385));
  assert.equal(r.status, 413);
  assert.deepEqual(r.body, { error: 'too_long', message: '"content" must be at most 16384 characters' });
  assert.equal((await post(w, FORGE_ROOM_ID, 'x'.repeat(16384))).status, 200);
});
test('post route: a bad schema is 400', async () => {
  const w = world();
  for (const raw of [{ content: 'x', room: STRATEGY }, { text: 'x' }, { content: '' }, 'not an object', { content: 5 }]) {
    assert.equal((await roomPost(CALLER, FORGE_ROOM_ID, raw, w.deps)).status, 400);
  }
  assert.equal(w.messages.length, 0);
});
test('post route: success writes one messages row and one room_post event, 200 { id, posted_at }', async () => {
  const w = world();
  const r = await post(w, SWARM_OPEN, 'try splitting the grammar');
  assert.deepEqual(r, { status: 200, body: { id: 'msg-1', posted_at: NOW.toISOString() } });
  assert.equal(w.messages.length, 1);
  const m = w.messages[0];
  assert.equal(m.honeycomb_id, SWARM_OPEN);
  assert.equal(m.agent_id, ECHO);
  assert.equal(m.content, 'try splitting the grammar');
  assert.equal(m.moderation_status, 'approved');
  const posts = w.events.filter((e) => e.event === 'room_post');
  assert.equal(posts.length, 1);
  assert.equal((posts[0].detail as { honeycomb_id: string }).honeycomb_id, SWARM_OPEN);
  assert.deepEqual(w.touched, [SWARM_OPEN]);
});
test('post route: rate limits are 6/hour per token and 60/hour per IP; the seventh is 429', async () => {
  assert.deepEqual(BEE_LIMITS.room_post, { limit: 6, windowSeconds: 3600, by: 'token' });
  assert.deepEqual(BEE_LIMITS.room_post_ip, { limit: 60, windowSeconds: 3600, by: 'ip' });
  const w = world();
  for (let i = 0; i < 6; i++) await post(w, WING_RO);
  await assert.rejects(post(w, WING_RO), (e: unknown) => e instanceof BeeError && e.status === 429);
});
test('post route: no handler result is ever 403', async () => {
  const w = world();
  await choose(w, STRATEGY);
  const outcomes = [
    await post(w, WING_NOVA),
    await post(w, ECHO_CHAMBER),
    await post(w, DREAMERS),
    await post(w, WING_RO),
    await post(w, FORGE_ROOM_ID),
    await post(w, FORGE_ROOM_ID),
    await (async () => {
      w.hits.room_post = 0; // a fresh hour, so the 429 is not what this test sees
      return post(w, STRATEGY, 'x'.repeat(20000));
    })(),
    await roomPost(CALLER, STRATEGY, { content: 'x', extra: 1 }, w.deps),
    await roomPost(CALLER, 'garbage', { content: 'x' }, world({ countFails: true }).deps),
    await roomPoll(CALLER, new URLSearchParams({ cursor: 'bad' }), w.deps),
  ];
  for (const r of outcomes) assert.notEqual(r.status, 403);
  for (const f of [
    join(REPO, 'lib', 'antenna', 'rooms.ts'),
    join(REPO, 'app', 'api', 'bee', 'rooms', 'route.ts'),
    join(REPO, 'app', 'api', 'bee', 'rooms', '[honeycomb_id]', 'post', 'route.ts'),
  ]) {
    assert.ok(!/\b403\b/.test(readFileSync(f, 'utf8').replace(/No 403[^\n]*/g, '')), f);
  }
});
test('patterns: rooms.ts imports the base ten from mail.ts and holds no copy of its own', () => {
  const src = readFileSync(join(REPO, 'lib', 'antenna', 'rooms.ts'), 'utf8');
  assert.match(src, /import \{[^}]*MAIL_BASE_PATTERNS[^}]*redactPatterns[^}]*\} from '\.\/mail';/);
  assert.ok(!src.includes('hive_bee_') && !src.includes('AKIA'));
});
test('check-bee-routes covers both new routes', () => {
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  const out = execFileSync('node', [join(REPO, 'scripts', 'check-bee-routes.mjs')], { encoding: 'utf8' });
  assert.match(out, /ok\s+app\/api\/bee\/rooms\/route\.ts/);
  assert.match(out, /ok\s+app\/api\/bee\/rooms\/\[honeycomb_id\]\/post\/route\.ts/);
});

// ─── SQL, by reading ──────────────────────────────────────────────────────────

const SQL = readFileSync(join(REPO, 'supabase', 'migrations', '20261114_rooms.sql'), 'utf8');
const ROLLBACK = readFileSync(join(REPO, 'supabase', 'migrations', '20261114_rooms_rollback.sql'), 'utf8');
const FUNCTIONS = ['wingmate_open', 'wingmate_fill', 'wingmate_release', 'swarm_open', 'swarm_close'];
const strip = (s: string) => s.replace(/--[^\n]*/g, '');

test('sql: the five functions are created, plpgsql', () => {
  const body = strip(SQL);
  for (const f of FUNCTIONS) assert.match(body, new RegExp(`CREATE OR REPLACE FUNCTION ${f}\\(`), f);
  assert.equal((body.match(/LANGUAGE plpgsql/g) ?? []).length, 5);
});
test('sql: each function is revoked from public, anon, authenticated and granted to service_role only', () => {
  const body = strip(SQL);
  for (const f of FUNCTIONS) {
    assert.match(body, new RegExp(`REVOKE ALL ON FUNCTION ${f}\\([^)]*\\) FROM public, anon, authenticated;`), f);
    assert.match(body, new RegExp(`GRANT EXECUTE ON FUNCTION ${f}\\([^)]*\\) TO service_role;`), f);
  }
  assert.ok(!/GRANT[^;]*\b(anon|authenticated|public)\b[^;]*;/i.test(body.replace(/REVOKE[^;]*;/g, '')));
});
test('sql: no private room is ever type hive, and nothing uses ON CONFLICT', () => {
  const body = strip(SQL);
  assert.ok(!/ON CONFLICT/i.test(body));
  assert.ok(!/'hive'/.test(body));
  assert.match(body, /VALUES \('Wingmates', 'wingmate', 'active', p_creator\)/);
  assert.match(body, /VALUES \('Swarm Call', p_wall, 'swarm', 'active', p_creator\)/);
});
test('sql: wingmate_pairs has exactly the brief columns, RLS on, and the two partial indexes', () => {
  const table = /CREATE TABLE IF NOT EXISTS wingmate_pairs \(([\s\S]*?)\n\);/.exec(SQL);
  assert.ok(table);
  const cols = table[1].split('\n').map((l) => l.trim().split(/\s+/)[0]).filter(Boolean);
  assert.deepEqual(cols, ['id', 'agent_a', 'agent_b', 'honeycomb_id', 'bonded_at', 'released_at', 'release_reason', 'elder_standin']);
  assert.match(SQL, /ALTER TABLE wingmate_pairs ENABLE ROW LEVEL SECURITY;/);
  assert.match(SQL, /REVOKE ALL ON TABLE wingmate_pairs FROM anon, authenticated;/);
  assert.match(SQL, /ON wingmate_pairs\(agent_a\)\s+WHERE released_at IS NULL;/);
  assert.match(SQL, /ON wingmate_pairs\(agent_b\)\s+WHERE released_at IS NULL AND agent_b IS NOT NULL;/);
});
test('sql: the CHECK gains exactly room_post and room_choice; the rollback restores the fourteen first', () => {
  const values = (s: string) => {
    const m = /ADD CONSTRAINT bee_client_events_event_check CHECK \(event IN \(([\s\S]*?)\)\);/.exec(s);
    assert.ok(m);
    return (m[1].match(/'[a-z_0-9]+'/g) ?? []).map((v) => v.slice(1, -1));
  };
  const fwd = values(SQL);
  const back = values(ROLLBACK);
  assert.equal(back.length, 14);
  assert.deepEqual(fwd, [...back, 'room_post', 'room_choice']);
  const r = strip(ROLLBACK);
  assert.ok(r.indexOf('ADD CONSTRAINT bee_client_events_event_check') < r.indexOf('DROP FUNCTION'));
  assert.ok(r.indexOf('DROP FUNCTION') < r.indexOf('DROP TABLE'));
});
test('sql: the rollback names every object the migration creates', () => {
  const body = strip(SQL);
  const r = strip(ROLLBACK);
  const created: string[] = [];
  // exec loops, not matchAll: the root tsconfig targets es5 and type-checks this file too.
  const objects = /CREATE (?:UNIQUE )?(?:INDEX|TABLE) IF NOT EXISTS (\w+)|CREATE OR REPLACE FUNCTION (\w+)\(/g;
  let m: RegExpExecArray | null;
  while ((m = objects.exec(body)) !== null) created.push(m[1] ?? m[2]);
  assert.equal(created.length, 8);
  for (const name of created) assert.match(r, new RegExp(`DROP (?:INDEX|TABLE|FUNCTION) IF EXISTS ${name}\\b`), name);
});
