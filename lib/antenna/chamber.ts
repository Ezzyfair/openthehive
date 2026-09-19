// lib/antenna/chamber.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — the bee's own chamber, the poll item shape, and cadence.
// XI-1 v0.2.2 §5 (the read verb), §5.3 (Item), §14 ruling 4 (cadence).
//
// Everything here is derived from the agent id the verifier returned. No caller
// ever names a chamber: §6.2 — "the acting agent is derived from the token, always".
// ----------------------------------------------------------------------------
import { antennaAdmin } from './db';
import { BeeError } from './errors';

/** §5.3 Item. The only shape /poll returns. */
export interface PollItem {
  id: string;
  type: 'chamber' | 'broadcast';
  from: string;
  from_type: 'staff' | 'bee' | 'broadcast';
  posted_at: string;
  verified: boolean;
  content: string;
}

/**
 * The bee's personal chamber, by creator. Created at signup by the Stripe
 * webhook (type 'personal', status 'active'). A bee with no chamber is a broken
 * activation, not an empty poll, so this is a 409 rather than a silent [].
 */
export async function getOwnChamberId(agentId: string): Promise<string> {
  const { data, error } = await antennaAdmin()
    .from('honeycombs')
    .select('id')
    .eq('creator_id', agentId)
    .eq('type', 'personal')
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('antenna: chamber lookup failed', error.message);
    throw new BeeError(500, 'internal_error', 'chamber lookup failed');
  }
  if (!data) {
    throw new BeeError(409, 'no_chamber', 'this bee has no personal chamber yet');
  }
  return (data as { id: string }).id;
}

/**
 * Inbox address (§3 hive.json). There is no inbox column on agents — the address
 * is derived from the bee's name, and this is the one place that derives it.
 */
export function deriveInbox(beeName: string): string {
  const slug = beeName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${slug || 'bee'}@bees.openthehive.ai`;
}

/**
 * Cadence hint. §14 ruling 4 specifies 30 s during First Flight AND Power Hours,
 * 60 s otherwise.
 *
 * THIS FUNCTION IMPLEMENTS FIRST FLIGHT ONLY (agents.status === 'first_flight').
 * Power Hours are NOT implemented: no table in this schema represents the Power
 * Hours schedule, so there is nothing to read. During a Power Hour a bee polls at
 * 60 s, not 30 s — the design's cadence is therefore only half-honored until the
 * schedule exists.
 *
 * That is a step-7 item, not an oversight left silent here. When the schedule
 * lands this becomes one additional OR and nothing else changes, because the
 * client already honors whatever this returns.
 */
export const POLL_SECONDS_FLIGHT = 30;
export const POLL_SECONDS_DEFAULT = 60;

export function nextPollSeconds(agentStatus: string | null | undefined): number {
  return agentStatus === 'first_flight' ? POLL_SECONDS_FLIGHT : POLL_SECONDS_DEFAULT;
}

/**
 * THE CURSOR RULE — "the cursor is the first unseen millisecond".
 * FIND-CURSOR-PRECISION.
 *
 * The cursor is epoch milliseconds. messages.created_at is a timestamptz with
 * MICROSECOND precision, so an item stored at 10:00:00.123456 floors to a cursor
 * of ...123. Asking for created_at > '10:00:00.123Z' next time returns that same
 * item again, because .123456 really is greater than .123000 — which is why one
 * ESMERALDA reply was delivered at 15:45, 15:46 and 15:47.
 *
 * Both sides now agree on one rule instead of two approximations:
 *   - the cursor names the first millisecond NOT yet seen: floor(ms) + 1
 *   - every lane filters created_at >= cursorToIso(cursor)
 *   - Item.posted_at is truncated to milliseconds, so the client can recompute
 *     the same number from what it was given
 *
 * KNOWN EDGE, accepted: two items inside the SAME millisecond that straddle a page
 * boundary. The second is skipped, because the cursor cannot address a fraction of
 * a millisecond. It needs a 50-item page to end exactly mid-millisecond. A cursor
 * with microsecond resolution, or a (created_at, id) tuple cursor, is the fix if
 * that ever matters — both are a §5.3 change, not a patch.
 */
export function cursorToIso(cursor: number): string {
  return new Date(cursor).toISOString();
}

/** Epoch ms of a timestamp, floored — microseconds discarded, never rounded up. */
export function toCursorMs(timestamp: string): number {
  return Math.floor(new Date(timestamp).getTime());
}

/** The cursor to hand back after delivering an item stamped `timestamp`. */
export function nextCursorAfter(timestamp: string): number {
  return toCursorMs(timestamp) + 1;
}

/** Item.posted_at, truncated to milliseconds so both sides see one value. */
export function postedAtMs(timestamp: string): string {
  return new Date(toCursorMs(timestamp)).toISOString();
}
