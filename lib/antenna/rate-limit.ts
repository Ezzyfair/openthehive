// lib/antenna/rate-limit.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — per-token / per-IP rate limits (XI-1 v0.2.2 §5.1, §6.7).
//
// Backed by bee_rate_limits + antenna_rate_hit(), shipped as
// supabase/migrations/20260913_antenna_rate_limits.sql. An in-process counter
// would be per-instance on Vercel, so the real ceiling would be limit x instances.
//
// FAILS CLOSED. If the counter is unreachable — the migration has not run, the
// table is gone, the DB is down — this returns 503, it does not wave the request
// through. Rate limits are a stated security property; silently disabling them on
// error is the kind of regression nobody notices until it is being exploited. The
// visible cost is that /api/bee/* answers 503 until the migration runs, which is
// the loudest possible reminder that it has not. Flagged for Nikita: if she wants
// fail-open for the read verbs, it is the one branch at the bottom of this file.
//
// ORDERING. Token-keyed scopes must be checked AFTER verifyBeeToken (the key is
// the token id). `activate` and `join` are IP-keyed and are checked BEFORE any
// auth, because no bee token exists yet at that point in the flow.
// ----------------------------------------------------------------------------
import { antennaAdmin } from './db';
import { BeeError } from './errors';
import { checkRunaway, writeBeeEvent } from './events';

export type BeeLimitScope =
  | 'activate'
  | 'poll'
  | 'reply'
  | 'awaken'
  | 'heartbeat'
  | 'revoke'
  | 'join'
  | 'installer';

export interface LimitSpec {
  limit: number;
  windowSeconds: number;
  by: 'token' | 'ip';
}

/** The table in §5.1, transcribed. This object is the only definition of the ceilings. */
export const BEE_LIMITS: Record<BeeLimitScope, LimitSpec> = {
  installer: { limit: 60, windowSeconds: 3600, by: 'ip' }, // /antenna/antenna.py + .sha256
  join: { limit: 20, windowSeconds: 3600, by: 'ip' }, //      GET /join/<install_token>
  activate: { limit: 5, windowSeconds: 3600, by: 'ip' },
  poll: { limit: 6, windowSeconds: 60, by: 'token' },
  reply: { limit: 20, windowSeconds: 60, by: 'token' },
  awaken: { limit: 1, windowSeconds: 3600, by: 'token' },
  heartbeat: { limit: 4, windowSeconds: 60, by: 'token' },
  revoke: { limit: 5, windowSeconds: 3600, by: 'token' },
};

export interface EnforceInput {
  scope: BeeLimitScope;
  /** Required for token-keyed scopes. */
  tokenId?: string | null;
  /** Required for IP-keyed scopes; also recorded on the event for token scopes. */
  ip?: string | null;
  /** Recorded on the rate_limit event and used by the runaway rule. */
  agentId?: string | null;
}

/**
 * Counts this request against its bucket. Returns quietly when allowed; throws
 * BeeError(429) with Retry-After when not, having written the rate_limit event
 * and run the runaway check (§6.8).
 */
export async function enforceRateLimit(input: EnforceInput): Promise<void> {
  const spec = BEE_LIMITS[input.scope];
  const identity = spec.by === 'token' ? input.tokenId : input.ip;

  if (!identity) {
    // A token-keyed scope with no token, or an IP-keyed scope with no resolvable
    // IP. Neither is a request we can account for, so neither is one we allow.
    throw new BeeError(
      spec.by === 'token' ? 401 : 400,
      spec.by === 'token' ? 'unauthorized' : 'no_client_ip',
      spec.by === 'token' ? 'rate limit requires an authenticated token' : 'could not determine client address',
    );
  }

  const nowMs = Date.now();
  const windowMs = spec.windowSeconds * 1000;
  const windowStartMs = Math.floor(nowMs / windowMs) * windowMs;
  const expiresMs = windowStartMs + windowMs;
  const bucketKey = `${input.scope}:${identity}:${windowStartMs}`;

  const { data, error } = await antennaAdmin().rpc('antenna_rate_hit', {
    p_bucket_key: bucketKey,
    p_window_start: new Date(windowStartMs).toISOString(),
    p_expires_at: new Date(expiresMs).toISOString(),
    p_limit: spec.limit,
  });

  if (error) {
    console.error('antenna: rate limiter unavailable, failing closed', input.scope, error.message);
    throw new BeeError(
      503,
      'rate_limiter_unavailable',
      'rate limiting is unavailable; request refused',
      Math.max(1, Math.ceil((expiresMs - nowMs) / 1000)),
    );
  }

  const row = Array.isArray(data) ? data[0] : data;
  const allowed = row?.out_allowed === true;
  const retryAfter = Number(row?.out_retry_after ?? Math.ceil((expiresMs - nowMs) / 1000)) || 1;

  if (allowed) return;

  await writeBeeEvent({
    event: 'rate_limit',
    agentId: input.agentId ?? null,
    ip: input.ip ?? null,
    detail: {
      scope: input.scope,
      limit: spec.limit,
      window_seconds: spec.windowSeconds,
      hits: row?.out_hits ?? null,
    },
  });
  await checkRunaway({ trigger: 'rate_limit', agentId: input.agentId ?? null, ip: input.ip ?? null });

  throw new BeeError(429, 'rate_limited', `rate limit exceeded for ${input.scope}`, retryAfter);
}
