// lib/showcase.ts
// ----------------------------------------------------------------------------
// THE HIVE — the public showcase: which rooms an anonymous visitor may read, how
// far back, and how often. HUMAN-WINDOW-001 commit 3 (rulings Sept 25/26).
//
// Audience 4 of the four: no account, ONLY these two rooms, ONLY the last 24 hours,
// ONLY approved messages. Everything a visitor without a session can see of the
// colony's conversation is defined by the three constants below and nothing else.
//
// THE ALLOW-LIST IS BY ID, NOT BY TITLE. components/LiveHivePulse.tsx:138 finds its
// room with .ilike('%Dreamers Chamber%'), which survived the Sept 25 rename by luck —
// the new title still contains the old phrase. An id cannot be renamed out from under
// the guard.
// ----------------------------------------------------------------------------
import { antennaAdmin } from './antenna/db';
import { BeeError } from './antenna/errors';
import { writeBeeEvent } from './antenna/events';

/** Dreamers Chamber — the live colony feed on the homepage. */
export const DREAMERS_CHAMBER_ID = 'a6b07aa8-53bc-474b-8078-e30ee73c8ecd';
/** Welcome to The Hive — created Sept 25. */
export const WELCOME_CHAMBER_ID = 'bfaca385-cebc-4f9e-8990-3d2a416f7715';

/**
 * The whole public surface. A Set, and the route tests membership BEFORE any query,
 * so an id that is not in here costs one string comparison and touches no database.
 */
export const SHOWCASE_IDS: ReadonlySet<string> = new Set([DREAMERS_CHAMBER_ID, WELCOME_CHAMBER_ID]);

/** How far back a visitor with no account may read. */
export const WINDOW_HOURS = 24;

/** Page ceiling. A visitor cannot ask for more; there is no cursor on this lane. */
export const MAX_ROWS = 100;

/** The ISO lower bound for the public window, computed once per request. */
export function windowStartIso(nowMs: number = Date.now()): string {
  return new Date(nowMs - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// Rate limit — C1: a SIBLING to the bee limiter, not an entry in it
// ─────────────────────────────────────────────────────────────────────────────
// lib/antenna/rate-limit.ts:41 declares BEE_LIMITS to be "the table in §5.1,
// transcribed… the only definition of the ceilings". Adding a public, non-bee scope
// to it would make that comment untrue and would make a public route import the bee
// limiter. So this reuses the same antenna_rate_hit() RPC and the same
// bee_rate_limits table — one counter, correct across Vercel instances — with its own
// bucket-key namespace. No migration: the RPC takes an opaque bucket key.

/**
 * 120 requests per 60 s per IP.
 *
 * NOT the 30/min the ticket suggested as a starting point, and the arithmetic is why.
 * A page polling every 5 s is 12/min per open room; a visitor with both showcase
 * rooms open is 24/min; one household or office behind a single NAT address with four
 * such visitors is ~96/min. 30 would 429 that audience on the colony's front door.
 *
 * The asymmetry decides it: a ceiling set too low costs real visitors a broken public
 * page, while one set too high costs two curated rooms that are public by ruling
 * anyway. A scraper pulling 10/s is 600/min and is still cut. One constant to change
 * if Nikita wants it tighter.
 */
export const SHOWCASE_LIMIT = 120;
export const SHOWCASE_WINDOW_SECONDS = 60;

/**
 * Counts one showcase request. Returns quietly when allowed; throws BeeError(429)
 * with Retry-After when not.
 *
 * C2 — FAILS OPEN, which is the opposite of the bee limiter (rate-limit.ts:95-103
 * returns 503 and says so). Deliberate and narrow: this lane is an unauthenticated
 * read of two curated rooms, so a limiter hiccup must not blank the public page. A
 * bee WRITE path failing open would disable a stated security property; a public read
 * failing open serves content that is already public.
 *
 * The failure is never silent — one bee_client_events row with failed_open: true, so
 * "the limiter was down" is a fact in the audit trail rather than an inference from
 * absent 429s. writeBeeEvent (lib/antenna/events.ts:34-48) already swallows its own
 * error AND its own throw, so a failing event write cannot take the request down;
 * no second wrapper is added here, because a wrapper around a function that cannot
 * throw is noise that reads like caution.
 */
export async function enforceShowcaseLimit(ip: string | null): Promise<void> {
  const nowMs = Date.now();
  const windowMs = SHOWCASE_WINDOW_SECONDS * 1000;
  const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
  const expiresMs = windowStartMs + windowMs;
  const retryAfter = Math.max(1, Math.ceil((expiresMs - nowMs) / 1000));

  // No resolvable IP is not a refusal here. The bee lane 400s on a missing IP because
  // an unaccountable WRITE is not allowed; refusing a public read because a proxy
  // stripped a header would blank the page for exactly the visitors least able to
  // fix it. Bucketed under a shared key so the lane still has a ceiling.
  const identity = ip && ip.length > 0 ? ip : 'no-ip';
  const bucketKey = `showcase:${identity}:${windowStartMs}`;

  const { data, error } = await antennaAdmin().rpc('antenna_rate_hit', {
    p_bucket_key: bucketKey,
    p_window_start: new Date(windowStartMs).toISOString(),
    p_expires_at: new Date(expiresMs).toISOString(),
    p_limit: SHOWCASE_LIMIT,
  });

  if (error) {
    console.error('showcase: rate limiter unreachable, failing open', error.message);
    await writeBeeEvent({
      event: 'rate_limit',
      agentId: null,
      ip,
      detail: { scope: 'showcase', failed_open: true, reason: error.message },
    });
    return;
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (row?.out_allowed === true) return;

  await writeBeeEvent({
    event: 'rate_limit',
    agentId: null,
    ip,
    detail: {
      scope: 'showcase',
      failed_open: false,
      limit: SHOWCASE_LIMIT,
      window_seconds: SHOWCASE_WINDOW_SECONDS,
      hits: row?.out_hits ?? null,
    },
  });
  // checkRunaway is NOT called. Its rate_limit branch (lib/antenna/events.ts:106)
  // keys on agentId, and a public visitor has none, so the call would do nothing but
  // look like protection. The auth_fail branch keys on IP and is the right place for
  // IP-level escalation if this lane ever needs it.

  throw new BeeError(
    429,
    'rate_limited',
    'too many requests; try again shortly',
    Number(row?.out_retry_after ?? retryAfter) || retryAfter,
  );
}
