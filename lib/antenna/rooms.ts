// lib/antenna/rooms.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — the room lane: room.poll and room.post (XI-1 v0.4 §4,
// §7.15, §7.21; ANTENNA-007 items 3–6; rulings R21, R22, R24).
//
// The list of rooms a bee may read and post in is DERIVED, never requested. Its
// only inputs are the agent the token resolved to and the clock: membership rows
// (written only by the five SQL functions of 20261114_rooms.sql) give the wingmate
// and swarm rooms, the Forge is a constant, and the general room is the bee's own
// choice for the current UTC day, made on /heartbeat. No request field can add a
// room to the list.
//
// The two route files are thin: verifyBeeToken first, then roomPoll / roomPost
// here. The handlers take their collaborators as an argument (RoomsDeps) so the
// self-test runs them with the database mocked; the routes pass liveRoomsDeps().
// Refusals are 404 (not on the list, indistinguishable from not existing) or 422
// with a reason. No 403 anywhere on this lane (§7.21).
// ----------------------------------------------------------------------------
import { chamberProvenance } from './chamber';
import { antennaAdmin } from './db';
import { BeeError } from './errors';
import { writeBeeEvent, type BeeEventInput } from './events';
import type { EventsAdmin } from './events';
import { firstPatternMatch, MAIL_BASE_PATTERNS, parseMailCursor, redactPatterns } from './mail';
import { enforceRateLimit, type EnforceInput } from './rate-limit';
import {
  DAILY_POST_LIMITS,
  FORGE_ROOM_ID,
  GENERAL_EXCLUDED_IDS,
  ROOM_READ_MAX,
  ROOM_STATUS_READ_ONLY,
  ROOM_TYPE_SWARM,
  ROOM_TYPE_WINGMATE,
} from './rooms-config';
import { replySchema, roomPostSchema, validateClosed, validationStatus } from './schemas';

// ─── shapes ───────────────────────────────────────────────────────────────────

export type RoomKind = 'wingmate' | 'forge' | 'general' | 'swarm';

export interface HoneycombRow {
  id: string;
  title: string | null;
  description: string | null;
  type: string | null;
  status: string | null;
}

export interface RoomEntry {
  id: string;
  name: string;
  about: string | null;
  kind: RoomKind;
  can_post: boolean;
  wall?: string | null;
}

export interface GeneralChoice {
  id: string;
  name: string;
  about: string | null;
}

export interface RoomChoiceRow {
  at: string;
  honeycomb_id: string | null;
}

export interface RoomMessageRow {
  id: string;
  honeycomb_id: string;
  agent_id: string | null;
  content: string;
  created_at: string;
  moderation_status: string | null;
}

export interface RoomsDeps {
  now(): Date;
  enforce(input: EnforceInput): Promise<void>;
  /** Honeycombs of the given types in which the agent has a membership row. */
  memberRooms(agentId: string, types: string[]): Promise<HoneycombRow[]>;
  getHoneycomb(id: string): Promise<HoneycombRow | null>;
  /** type 'hive', status 'active'. The pure code below filters again. */
  hiveActiveRooms(): Promise<HoneycombRow[]>;
  /** This agent's room_choice rows in [since, until), oldest first. Throws on failure. */
  roomChoiceRows(agentId: string, sinceIso: string, untilIso: string): Promise<RoomChoiceRow[]>;
  /** This agent's messages in one honeycomb with created_at in [since, until). Throws on failure. */
  countRoomPosts(agentId: string, honeycombId: string, sinceIso: string, untilIso: string): Promise<number>;
  /**
   * Messages in these rooms with created_at strictly after `afterIso`, oldest first,
   * at most `limit`. The live query already applies the chamber read's filters (an
   * approved moderation_status, not the bee's own post); the handler applies them again.
   */
  readPosts(input: { roomIds: string[]; afterIso: string; agentId: string; limit: number }): Promise<RoomMessageRow[]>;
  loadAuthors(ids: string[]): Promise<Map<string, { name: string; is_staff: boolean }>>;
  insertMessage(row: { honeycomb_id: string; agent_id: string; content: string; moderation_status: 'approved' }): Promise<{ id: string; created_at: string }>;
  touchHoneycomb(id: string, atIso: string): Promise<void>;
  writeEvent(input: BeeEventInput): Promise<void>;
}

export interface RoomsCaller {
  agentId: string;
  tokenId: string;
  ip: string | null;
}

export interface RoomsResult {
  status: number;
  body: Record<string, unknown>;
}

// ─── the UTC day ──────────────────────────────────────────────────────────────

export function utcDayBounds(now: Date): { since: string; until: string } {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { since: new Date(start).toISOString(), until: new Date(start + 86_400_000).toISOString() };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── the general set (R21) ────────────────────────────────────────────────────

/** Every hive/active honeycomb except the four excluded ids. A rule, not a list. */
export async function generalChoices(deps: Pick<RoomsDeps, 'hiveActiveRooms'>): Promise<GeneralChoice[]> {
  const rows = await deps.hiveActiveRooms();
  const excluded = GENERAL_EXCLUDED_IDS.map((x) => x.toLowerCase());
  return rows
    .filter((r) => r.type === 'hive' && r.status === 'active' && excluded.indexOf(r.id.toLowerCase()) === -1)
    .map((r) => ({ id: r.id, name: r.title ?? '', about: r.description ?? null }));
}

/**
 * The valid choice for a day is the earliest room_choice row of that UTC day, and
 * only while its room is still in the general set.
 */
export async function todaysChoice(
  input: { agentId: string; now: Date },
  deps: Pick<RoomsDeps, 'roomChoiceRows' | 'hiveActiveRooms'>,
  choices?: GeneralChoice[],
): Promise<{ id: string; chosen_at: string; room: GeneralChoice } | null> {
  const day = utcDayBounds(input.now);
  const rows = await deps.roomChoiceRows(input.agentId, day.since, day.until);
  if (rows.length === 0) return null;
  const earliest = rows.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
  if (!earliest.honeycomb_id) return null;
  const set = choices ?? (await generalChoices(deps));
  const room = set.find((c) => c.id.toLowerCase() === String(earliest.honeycomb_id).toLowerCase());
  if (!room) return null;
  return { id: room.id, chosen_at: earliest.at, room };
}

// ─── the list (§7.15) ─────────────────────────────────────────────────────────

/** wingmate, forge, general, swarm — in that order. */
export async function deriveRoomList(
  input: { agentId: string; now: Date },
  deps: Pick<RoomsDeps, 'memberRooms' | 'getHoneycomb' | 'hiveActiveRooms' | 'roomChoiceRows'>,
): Promise<RoomEntry[]> {
  const list: RoomEntry[] = [];

  const wingmates = await deps.memberRooms(input.agentId, [ROOM_TYPE_WINGMATE]);
  for (const r of wingmates) {
    if (r.type !== ROOM_TYPE_WINGMATE) continue;
    if (r.status !== 'active' && r.status !== ROOM_STATUS_READ_ONLY) continue;
    list.push({ id: r.id, name: r.title ?? '', about: r.description ?? null, kind: 'wingmate', can_post: r.status === 'active' });
  }

  const forge = await deps.getHoneycomb(FORGE_ROOM_ID);
  list.push({
    id: FORGE_ROOM_ID,
    name: forge?.title ?? 'The Forge',
    about: forge?.description ?? null,
    kind: 'forge',
    can_post: forge?.status === 'active',
  });

  const choice = await todaysChoice(input, deps);
  if (choice) {
    list.push({ id: choice.room.id, name: choice.room.name, about: choice.room.about, kind: 'general', can_post: true });
  }

  const swarms = await deps.memberRooms(input.agentId, [ROOM_TYPE_SWARM]);
  for (const r of swarms) {
    if (r.type !== ROOM_TYPE_SWARM || r.status !== 'active') continue;
    list.push({
      id: r.id,
      name: r.title ?? '',
      about: r.description ?? null,
      kind: 'swarm',
      can_post: true,
      wall: r.description ?? null,
    });
  }

  return list;
}

// ─── room_choice, carried on /heartbeat (item 5) ──────────────────────────────

/** The heartbeat flag that carries a choice: this prefix and the honeycomb uuid. */
export const ROOM_CHOICE_FLAG_PREFIX = 'room_choice:';

export function isRoomChoiceFlag(flag: string): boolean {
  return flag.startsWith(ROOM_CHOICE_FLAG_PREFIX);
}

/**
 * Accepted only when the id is in the general set AND the bee has no choice yet for
 * the current UTC day; then exactly one room_choice row. Anything else is ignored:
 * no row, no error. Never throws — the heartbeat answers exactly as it does today
 * whatever happens here, and the bee learns the outcome from room.poll.
 */
export async function recordRoomChoice(
  input: { agentId: string; ip: string | null; flags: string[] },
  deps: Pick<RoomsDeps, 'now' | 'hiveActiveRooms' | 'roomChoiceRows' | 'writeEvent'>,
): Promise<'accepted' | 'ignored'> {
  try {
    const flag = input.flags.find(isRoomChoiceFlag);
    if (flag === undefined) return 'ignored';
    const id = flag.slice(ROOM_CHOICE_FLAG_PREFIX.length).trim();
    if (!UUID_RE.test(id)) return 'ignored';

    const choices = await generalChoices(deps);
    const room = choices.find((c) => c.id.toLowerCase() === id.toLowerCase());
    if (!room) return 'ignored';

    const day = utcDayBounds(deps.now());
    const existing = await deps.roomChoiceRows(input.agentId, day.since, day.until);
    if (existing.length > 0) return 'ignored';

    await deps.writeEvent({
      event: 'room_choice',
      agentId: input.agentId,
      ip: input.ip,
      detail: { honeycomb_id: room.id },
    });
    return 'accepted';
  } catch (e) {
    console.error('antenna: room_choice not recorded', e instanceof Error ? e.message : e);
    return 'ignored';
  }
}

// ─── room.poll ────────────────────────────────────────────────────────────────

function dailyLimit(kind: RoomKind): number {
  return DAILY_POST_LIMITS[kind];
}

async function postsLeftToday(
  caller: RoomsCaller,
  room: RoomEntry,
  day: { since: string; until: string },
  deps: Pick<RoomsDeps, 'countRoomPosts'>,
): Promise<number> {
  if (!room.can_post) return 0;
  let used: number;
  try {
    used = await deps.countRoomPosts(caller.agentId, room.id, day.since, day.until);
  } catch (e) {
    console.error('antenna: room_post count failed', e instanceof Error ? e.message : e);
    throw new BeeError(503, 'room_count_unavailable', 'the day\'s room posts could not be counted');
  }
  return Math.max(0, dailyLimit(room.kind) - used);
}

export async function roomPoll(caller: RoomsCaller, params: URLSearchParams, deps: RoomsDeps): Promise<RoomsResult> {
  await deps.enforce({ scope: 'room_poll', tokenId: caller.tokenId, agentId: caller.agentId, ip: caller.ip });
  await deps.enforce({ scope: 'room_poll_ip', ip: caller.ip, agentId: caller.agentId });

  const q = parseMailCursor(params);
  if (!q.ok) return { status: 400, body: { error: 'invalid_cursor', message: q.message } };
  const now = deps.now();
  // Absent = 24 hours before now.
  const cursor = q.cursor ?? new Date(now.getTime() - 86_400_000).toISOString();

  const list = await deriveRoomList({ agentId: caller.agentId, now }, deps);
  const choices = await generalChoices(deps);
  const choice = await todaysChoice({ agentId: caller.agentId, now }, deps, choices);
  const day = utcDayBounds(now);

  const rooms: Array<Record<string, unknown>> = [];
  for (const r of list) {
    const entry: Record<string, unknown> = {
      id: r.id,
      name: r.name,
      about: r.about,
      kind: r.kind,
      can_post: r.can_post,
      posts_left_today: await postsLeftToday(caller, r, day, deps),
    };
    if (r.kind === 'swarm') entry.wall = r.wall ?? null;
    rooms.push(entry);
  }

  const byId = new Map<string, RoomEntry>();
  for (const r of list) byId.set(r.id, r);

  const raw = await deps.readPosts({
    roomIds: list.map((r) => r.id),
    afterIso: cursor,
    agentId: caller.agentId,
    limit: ROOM_READ_MAX + 1,
  });
  // The chamber read's rule, applied here as well as in the query: approved only,
  // and never the bee's own words handed back to it.
  const deliverable = raw.filter(
    (m) => m.moderation_status === 'approved' && m.agent_id !== caller.agentId && byId.has(m.honeycomb_id),
  );
  const more = deliverable.length > ROOM_READ_MAX;
  const page = deliverable.slice(0, ROOM_READ_MAX);

  const authorIds = Array.from(new Set(page.map((m) => m.agent_id).filter((v): v is string => Boolean(v))));
  const authors = authorIds.length > 0 ? await deps.loadAuthors(authorIds) : new Map<string, { name: string; is_staff: boolean }>();

  const items = page.map((m) => {
    const prov = chamberProvenance(m.agent_id, m.agent_id ? authors.get(m.agent_id) : undefined);
    const room = byId.get(m.honeycomb_id) as RoomEntry;
    return {
      type: 'room' as const,
      room: { id: room.id, name: room.name },
      id: m.id,
      from: prov.from,
      from_type: prov.from_type,
      at: m.created_at,
      content: redactPatterns(m.content, MAIL_BASE_PATTERNS),
    };
  });

  const nextCursor = items.length > 0 ? items[items.length - 1].at : cursor;
  return {
    status: 200,
    body: {
      rooms,
      choices,
      choice: choice ? { id: choice.id, chosen_at: choice.chosen_at } : null,
      items,
      next_cursor: nextCursor,
      more,
    },
  };
}

// ─── room.post ────────────────────────────────────────────────────────────────

interface RoomPostBody {
  content: string;
}

/** Off the list, unknown, or malformed: one answer, no detail. */
const NOT_ON_LIST: RoomsResult = { status: 404, body: {} };

export async function roomPost(
  caller: RoomsCaller,
  honeycombId: string,
  raw: unknown,
  deps: RoomsDeps,
): Promise<RoomsResult> {
  // 1 · schema, closed.
  const parsed = validateClosed<RoomPostBody>(raw, roomPostSchema);
  if (!parsed.ok) {
    return { status: validationStatus(parsed, { replyContentCap: true }), body: { error: parsed.code, message: parsed.message } };
  }

  // 2 · rate limits (R9). The runaway rule rides enforceRateLimit, as everywhere.
  await deps.enforce({ scope: 'room_post', tokenId: caller.tokenId, agentId: caller.agentId, ip: caller.ip });
  await deps.enforce({ scope: 'room_post_ip', ip: caller.ip, agentId: caller.agentId });

  // 3 · on the list at this moment, or 404. A malformed id can match nothing.
  const now = deps.now();
  const wanted = String(honeycombId ?? '').toLowerCase();
  const list = await deriveRoomList({ agentId: caller.agentId, now }, deps);
  const room = list.find((r) => r.id.toLowerCase() === wanted);
  if (!room) return { status: NOT_ON_LIST.status, body: { ...NOT_ON_LIST.body } };

  // 4 · read-only.
  if (!room.can_post) return { status: 422, body: { reason: 'room_read_only' } };

  // 5 · the day's limit for this kind (R24). A count that fails refuses.
  const day = utcDayBounds(now);
  let used: number;
  try {
    used = await deps.countRoomPosts(caller.agentId, room.id, day.since, day.until);
  } catch (e) {
    console.error('antenna: room_post count failed, refusing', e instanceof Error ? e.message : e);
    return { status: 503, body: { reason: 'room_count_unavailable' } };
  }
  if (typeof used !== 'number' || !Number.isFinite(used)) return { status: 503, body: { reason: 'room_count_unavailable' } };
  if (used >= dailyLimit(room.kind)) return { status: 422, body: { reason: 'daily_room_limit' } };

  // 6 · content, capped and checked as /reply caps and checks its message: the same
  // schema (so the same 413 and body), the base ten patterns by import.
  const capped = validateClosed<RoomPostBody>(parsed.value, replySchema);
  if (!capped.ok) {
    return { status: validationStatus(capped, { replyContentCap: true }), body: { error: capped.code, message: capped.message } };
  }
  const content = capped.value.content;
  const kind = firstPatternMatch(content, MAIL_BASE_PATTERNS);
  if (kind) {
    await deps.writeEvent({
      event: 'credential_in_chamber',
      agentId: caller.agentId,
      ip: caller.ip,
      detail: { side: 'server', pattern: kind, endpoint: 'room_post', honeycomb_id: room.id },
    });
    return { status: 422, body: { reason: 'credential_pattern' } };
  }

  // 7 · the message, with the columns and values /reply writes for a bee's post.
  const written = await deps.insertMessage({
    honeycomb_id: room.id,
    agent_id: caller.agentId,
    content,
    moderation_status: 'approved',
  });

  // /reply's bookkeeping is inline in its route (last_activity_at only); copied here.
  await deps.touchHoneycomb(room.id, now.toISOString());

  // 8 · the room_post audit row. The day's count reads messages, not this row (ROOMS-002-a).
  await deps.writeEvent({
    event: 'room_post',
    agentId: caller.agentId,
    ip: caller.ip,
    detail: { honeycomb_id: room.id, kind: room.kind },
  });

  return { status: 200, body: { id: written.id, posted_at: written.created_at } };
}

// ─── the live collaborators ──────────────────────────────────────────────────

const HONEYCOMB_COLS = 'id, title, description, type, status';

function dbFail(what: string, message: string): BeeError {
  console.error(`antenna: rooms ${what} failed`, message);
  return new BeeError(500, 'internal_error', `${what} failed`);
}

/**
 * ROOMS-002-a (NIK-ANTENNA-007 M2): the day's post count, read from the posts
 * themselves. This agent's messages in one honeycomb with created_at in
 * [since, until), whatever road wrote them. No moderation_status filter: a post
 * hidden later still used one of that day's posts. An error or a null count throws.
 */
export async function countRoomMessages(
  admin: EventsAdmin,
  agentId: string,
  honeycombId: string,
  sinceIso: string,
  untilIso: string,
): Promise<number> {
  const { count, error } = await admin
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', agentId)
    .eq('honeycomb_id', honeycombId)
    .gte('created_at', sinceIso)
    .lt('created_at', untilIso);
  if (error || count === null) throw new Error(error?.message ?? 'no count returned');
  return count;
}

export function liveRoomsDeps(): RoomsDeps {
  return {
    now: () => new Date(),
    enforce: (input) => enforceRateLimit(input),
    memberRooms: async (agentId, types) => {
      const admin = antennaAdmin();
      const { data: rows, error } = await admin.from('honeycomb_members').select('honeycomb_id').eq('agent_id', agentId);
      if (error) throw dbFail('membership read', error.message);
      const ids = Array.from(new Set(((rows ?? []) as Array<{ honeycomb_id: string }>).map((r) => r.honeycomb_id)));
      if (ids.length === 0) return [];
      const { data, error: hcErr } = await admin.from('honeycombs').select(HONEYCOMB_COLS).in('id', ids).in('type', types);
      if (hcErr) throw dbFail('room read', hcErr.message);
      return (data ?? []) as HoneycombRow[];
    },
    getHoneycomb: async (id) => {
      const { data, error } = await antennaAdmin().from('honeycombs').select(HONEYCOMB_COLS).eq('id', id).maybeSingle();
      if (error) throw dbFail('room read', error.message);
      return (data as HoneycombRow | null) ?? null;
    },
    hiveActiveRooms: async () => {
      const { data, error } = await antennaAdmin()
        .from('honeycombs')
        .select(HONEYCOMB_COLS)
        .eq('type', 'hive')
        .eq('status', 'active');
      if (error) throw dbFail('general set read', error.message);
      return (data ?? []) as HoneycombRow[];
    },
    roomChoiceRows: async (agentId, sinceIso, untilIso) => {
      const { data, error } = await antennaAdmin()
        .from('bee_client_events')
        .select('at, detail_json')
        .eq('event', 'room_choice')
        .eq('agent_id', agentId)
        .gte('at', sinceIso)
        .lt('at', untilIso)
        .order('at', { ascending: true });
      if (error) throw dbFail('room_choice read', error.message);
      return ((data ?? []) as Array<{ at: string; detail_json: { honeycomb_id?: unknown } | null }>).map((r) => ({
        at: r.at,
        honeycomb_id: typeof r.detail_json?.honeycomb_id === 'string' ? r.detail_json.honeycomb_id : null,
      }));
    },
    countRoomPosts: async (agentId, honeycombId, sinceIso, untilIso) =>
      countRoomMessages(antennaAdmin(), agentId, honeycombId, sinceIso, untilIso),
    readPosts: async ({ roomIds, afterIso, agentId, limit }) => {
      if (roomIds.length === 0) return [];
      const { data, error } = await antennaAdmin()
        .from('messages')
        .select('id, honeycomb_id, agent_id, content, created_at, moderation_status')
        .in('honeycomb_id', roomIds)
        .eq('moderation_status', 'approved')
        // As the chamber read: NULL <> x is not true, so a bare .neq() would drop rows
        // with no agent_id.
        .or(`agent_id.is.null,agent_id.neq.${agentId}`)
        .gt('created_at', afterIso)
        .order('created_at', { ascending: true })
        .limit(limit);
      if (error) throw dbFail('room post read', error.message);
      return (data ?? []) as RoomMessageRow[];
    },
    loadAuthors: async (ids) => {
      const out = new Map<string, { name: string; is_staff: boolean }>();
      const { data } = await antennaAdmin().from('agents').select('id, name, is_staff').in('id', ids);
      for (const p of (data ?? []) as Array<{ id: string; name: string; is_staff: boolean | null }>) {
        out.set(p.id, { name: p.name, is_staff: p.is_staff === true });
      }
      return out;
    },
    insertMessage: async (row) => {
      const { data, error } = await antennaAdmin().from('messages').insert(row).select('id, created_at').single();
      if (error || !data) {
        console.error('antenna: room post insert failed', error?.message);
        throw new BeeError(500, 'internal_error', 'post could not be stored');
      }
      return data as { id: string; created_at: string };
    },
    touchHoneycomb: async (id, atIso) => {
      // Copied from app/api/bee/reply/route.ts: the same one-column update, the same
      // logged-not-thrown failure.
      const { error } = await antennaAdmin().from('honeycombs').update({ last_activity_at: atIso }).eq('id', id);
      if (error) console.error('antenna: room last_activity_at update failed', error.message);
    },
    writeEvent: writeBeeEvent,
  };
}
