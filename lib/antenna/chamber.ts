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
 * §14 ruling 4: 30 s during First Flight and Power Hours, 60 s otherwise,
 * server-hinted. First Flight is agents.status === 'first_flight'.
 *
 * Power Hours are not yet represented in any table this route can read, so they
 * do not shorten the interval today. Flagged for step 7 — when the schedule
 * exists, it is one OR in this function and nothing else changes, because the
 * client already honors whatever this returns.
 */
export const POLL_SECONDS_FLIGHT = 30;
export const POLL_SECONDS_DEFAULT = 60;

export function nextPollSeconds(agentStatus: string | null | undefined): number {
  return agentStatus === 'first_flight' ? POLL_SECONDS_FLIGHT : POLL_SECONDS_DEFAULT;
}

/** Cursor is epoch milliseconds, server-authoritative (§4). */
export function cursorToIso(cursor: number): string {
  return new Date(cursor).toISOString();
}
