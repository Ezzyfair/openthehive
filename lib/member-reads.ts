// lib/member-reads.ts
// ----------------------------------------------------------------------------
// THE HIVE — shared paging and shaping for the member-facing reads
// (HUMAN-WINDOW-001 commit 2, rulings Sept 25/26).
//
// Two routes page a room: /api/member/chamber and /api/member/colony/[id]. The
// validation and the row shape live here rather than twice, because a paging rule
// that is written twice is a paging rule that drifts once.
//
// THE CURSOR IS NOT REDEFINED HERE. lib/antenna/chamber.ts owns it —
// cursorToIso / toCursorMs / nextCursorAfter / postedAtMs, and the rule "the cursor
// names the first millisecond NOT yet seen" (FIND-CURSOR-PRECISION). This module
// imports that contract and adds nothing to it. One rule, one place.
// ----------------------------------------------------------------------------
import { cursorToIso, nextCursorAfter, postedAtMs } from './antenna/chamber';
import { BeeError } from './antenna/errors';

/** Page size. 50 is the ruling; a caller may ask for less, never more. */
export const MAX_LIMIT = 50;
export const DEFAULT_LIMIT = 50;

export interface PageRequest {
  cursor: number;
  limit: number;
}

/**
 * Parses ?cursor= and ?limit=. Closed shape: an unknown query parameter is a 400,
 * matching how every /api/bee/* body is validated. A member route is not a place
 * to silently ignore a parameter the caller believed in.
 *
 * cursor is OPTIONAL here and defaults to 0 — the start of the room's history.
 * /api/bee/poll requires it because a bee always has one in hive.json; a human
 * opening a page for the first time has nothing to send.
 */
export function parsePageQuery(params: URLSearchParams): PageRequest {
  const keys: string[] = [];
  // forEach, not for...of: the repo targets es5 and iterating URLSearchParams
  // directly needs --downlevelIteration.
  params.forEach((_v, k) => {
    keys.push(k);
  });
  const unknown = keys.find((k) => k !== 'cursor' && k !== 'limit');
  if (unknown !== undefined) {
    throw new BeeError(400, 'unknown_parameter', `unknown query parameter "${unknown}"`);
  }

  const rawCursor = params.get('cursor');
  let cursor = 0;
  if (rawCursor !== null) {
    if (!/^\d+$/.test(rawCursor)) {
      throw new BeeError(400, 'invalid_cursor', '"cursor" must be a non-negative integer');
    }
    cursor = Number(rawCursor);
    if (!Number.isSafeInteger(cursor)) {
      throw new BeeError(400, 'invalid_cursor', '"cursor" is out of range');
    }
  }

  const rawLimit = params.get('limit');
  let limit = DEFAULT_LIMIT;
  if (rawLimit !== null) {
    if (!/^\d+$/.test(rawLimit)) {
      throw new BeeError(400, 'invalid_limit', '"limit" must be a positive integer');
    }
    limit = Number(rawLimit);
    if (limit < 1 || limit > MAX_LIMIT) {
      throw new BeeError(400, 'invalid_limit', `"limit" must be between 1 and ${MAX_LIMIT}`);
    }
  }

  return { cursor, limit };
}

export interface MessageItem {
  id: string;
  from: string | null;
  from_emoji: string | null;
  posted_at: string;
  content: string;
}

export interface MessagePage {
  messages: MessageItem[];
  next_cursor: number;
  has_more: boolean;
}

/** The ISO lower bound for a cursor, so callers never build it themselves. */
export function sinceIso(cursor: number): string {
  return cursorToIso(cursor);
}

/**
 * Shapes a page of rows and computes the cursor to ask with next.
 *
 * next_cursor is returned even on a short page, and then it is one past the last
 * row delivered — or the caller's own cursor when the page was empty. That is what
 * makes polling work (C4: poll, no realtime): the client asks again with the same
 * number and gets nothing until something new is posted.
 */
export function shapePage(
  rows: Array<{ id: string; content: string; created_at: string; agent_id: string | null }>,
  agents: Record<string, { name?: string | null; soul_emoji?: string | null }>,
  req: PageRequest,
): MessagePage {
  const messages: MessageItem[] = rows.map((r) => ({
    id: r.id,
    from: (r.agent_id && agents[r.agent_id]?.name) || null,
    from_emoji: (r.agent_id && agents[r.agent_id]?.soul_emoji) || null,
    posted_at: postedAtMs(r.created_at),
    content: r.content,
  }));

  const last = rows.length > 0 ? rows[rows.length - 1] : null;
  return {
    messages,
    next_cursor: last ? nextCursorAfter(last.created_at) : req.cursor,
    has_more: rows.length === req.limit,
  };
}
