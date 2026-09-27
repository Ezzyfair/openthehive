// lib/chat-view.ts
// ----------------------------------------------------------------------------
// THE HIVE — one definition of how a human-facing chat view behaves.
// HUMAN-WINDOW-001 commit 4 (C4, C5b, item 5, item 6).
//
// WHY THIS FILE EXISTS
//
//   1. C4 · "every human-facing chat view keeps the Dreamers typing animation at
//      the SAME speed". The constants below are the only copy of those numbers. They
//      were duplicated in app/honeycombs/[id]/page.tsx:13-15 and
//      components/LiveHivePulse.tsx:27-31, which is how two views drift apart.
//
//   2. Item 6 · "a failed read renders a stated error, NEVER 'No messages yet'".
//      viewState() below is the ONLY place that decides which state a view shows, and
//      it puts `error` ahead of `empty` unconditionally. The old bug was not a missing
//      error message — it was that a denial and an empty room produced the same
//      pixels, because the error was never bound at all.
//
//      This repo has NO test runner and no component-render harness, so the render
//      decision is extracted here as a PURE FUNCTION and tested directly (the option
//      the ticket allows). Each view then renders per state and contains no branching
//      of its own about loading/error/empty.
//
//   3. C4 · polling replaces realtime everywhere. POLL_MS is the one interval.
// ----------------------------------------------------------------------------

/** C4 — the Dreamers typing animation. One copy, imported everywhere. */
export const CHARS_PER_TICK = 2;
export const TYPING_MS = 35;
/** LiveHivePulse's replay pacing, kept here so the whole animation reads as one unit. */
export const THINKING_MS = 5000;
export const PAUSE_MS = 2500;
/** Longest message body a view renders before truncating. */
export const MAX_CONTENT = 600;

/** C4 — poll interval. No realtime channel exists anywhere after this commit. */
export const POLL_MS = 5000;

export function truncate(t: string): string {
  return t.length > MAX_CONTENT ? t.slice(0, MAX_CONTENT) + '…' : t;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  if (h < 24) return `${h}h ago`;
  if (d === 1) return 'yesterday';
  return `${d}d ago`;
}

export function isLive(iso: string | null | undefined): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 30 * 60 * 1000;
}

export interface ChatMessage {
  id: string;
  from: string | null;
  from_emoji: string | null;
  posted_at: string;
  content: string;
}

/** The locked copy, in one place so every surface says the same thing (item 2). */
export const LOCKED_TITLE = 'Members only';
export const LOCKED_BODY = 'Sign in to read this room.';

export type ViewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'locked' }
  | { kind: 'no-chamber'; hint: string }
  | { kind: 'empty' }
  | { kind: 'messages'; messages: ChatMessage[] };

export interface ViewInput {
  loading: boolean;
  /** Non-null means the read failed. Anything non-null wins over `empty`. */
  error: string | null;
  /** The read said 404 / not visible to this caller. Never distinguishes why. */
  locked?: boolean;
  /** C3 — the member has no chamber yet. */
  chamberNull?: boolean;
  hint?: string | null;
  /** null means "not read yet", [] means "read, and the room is empty". */
  messages: ChatMessage[] | null;
}

/**
 * The single render decision for every chat view.
 *
 * ORDER IS THE WHOLE POINT and it is asserted in the suite:
 *   error  BEFORE  empty   — a failed read can never render "No messages yet"
 *   error  BEFORE  loading — a read that failed is not still loading
 *   locked BEFORE  empty   — a room we may not see is not an empty room
 * A null `messages` with no error is still loading, not empty: "not read yet" and
 * "read and found nothing" are different facts and the old code conflated them.
 */
export function viewState(input: ViewInput): ViewState {
  if (input.error) return { kind: 'error', message: input.error };
  if (input.locked) return { kind: 'locked' };
  if (input.loading) return { kind: 'loading' };
  if (input.chamberNull) {
    return { kind: 'no-chamber', hint: input.hint || 'Your chamber is not open yet.' };
  }
  if (input.messages === null) return { kind: 'loading' };
  if (input.messages.length === 0) return { kind: 'empty' };
  return { kind: 'messages', messages: input.messages };
}

export interface ReadResult<T> {
  ok: boolean;
  data: T | null;
  /** Human-readable, for the error state. Null only when ok. */
  error: string | null;
  /** HTTP status, or 0 when the request never completed. */
  status: number;
}

/**
 * The one fetch used by every view. It NEVER throws and it ALWAYS reports an error
 * for a non-2xx, which is the property item 6 turns on: a caller cannot accidentally
 * treat a failure as an empty result, because there is no shape in which that happens.
 *
 * cache: 'no-store' on the request as well — these are live reads from the browser,
 * and a cached member response is a stale chamber.
 */
export async function readJson<T = any>(url: string): Promise<ReadResult<T>> {
  try {
    const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin' });
    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const message =
        (body && (body.message || body.error)) ||
        `The colony could not be reached (${res.status}).`;
      return { ok: false, data: body, error: String(message), status: res.status };
    }
    return { ok: true, data: body as T, error: null, status: res.status };
  } catch (e: any) {
    return {
      ok: false,
      data: null,
      error: 'The colony could not be reached. Check your connection and try again.',
      status: 0,
    };
  }
}

/**
 * Maps a failed read of a ROOM to either `locked` or a stated error (item 2).
 * 404 and 401 both mean "not for you" and must be indistinguishable — never confirm
 * that a room exists. Everything else is a real failure and says so.
 */
export function lockedOrError(r: ReadResult<any>): { locked: boolean; error: string | null } {
  if (r.ok) return { locked: false, error: null };
  if (r.status === 404 || r.status === 401 || r.status === 403) return { locked: true, error: null };
  return { locked: false, error: r.error };
}

// ─────────────────────────────────────────────────────────────────────────────
// C5b — the room index, as a pure function
// ─────────────────────────────────────────────────────────────────────────────

export interface RoomRow {
  id: string;
  title: string;
  description?: string | null;
  type: string;
  message_count?: number | null;
  last_activity_at: string;
  status?: string;
}

export interface ListedRoom extends RoomRow {
  locked?: boolean;
}

/**
 * C5b (Francis, Sept 26) — what each audience sees in the room index.
 *
 *   member     every active hive room, in full.
 *   anonymous  the two showcase rooms in full; every OTHER active hive room as a
 *              locked TITLE with no description and no message count.
 *   nobody     a personal chamber. Not in full, not as a locked title, not at all —
 *              the title of a bee's private chamber is itself information.
 *
 * Extracted here because this repo has no component-render harness: the decision is
 * tested directly rather than through a rendered page.
 */
export function listRooms(
  rooms: RoomRow[],
  opts: { isMember: boolean; showcaseIds: ReadonlySet<string> },
): ListedRoom[] {
  const hive = rooms.filter((r) => r.type === 'hive' && (r.status === undefined || r.status === 'active'));
  if (opts.isMember) return hive.map((r) => ({ ...r }));
  return hive.map((r) => {
    if (opts.showcaseIds.has(r.id)) return { ...r };
    return {
      id: r.id,
      title: r.title,
      type: r.type,
      last_activity_at: r.last_activity_at,
      locked: true,
    };
  });
}
