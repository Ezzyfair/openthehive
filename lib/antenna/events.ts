// lib/antenna/events.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — the bee_client_events writer (XI-1 v0.2.2 §6.12) and the
// runaway rule (§6.8).
//
// Writing an audit row must never be the reason a request fails: every write
// here is best-effort and swallows its own error after logging. The row is the
// record, not the control flow.
// ----------------------------------------------------------------------------
import type { SupabaseClient } from '@supabase/supabase-js';
import { antennaAdmin } from './db';

/**
 * The bee_client_events.event CHECK values (§9), plus `human_paired` added by
 * ANTENNA-003 ruling 5 (migration 20261107_human_paired.sql widens the CHECK).
 */
export type BeeEvent =
  | 'activate'
  | 'revoke'
  | 'awaken'
  | 'heartbeat_flag'
  | 'rate_limit'
  | 'runaway'
  | 'auth_fail'
  | 'credential_in_chamber'
  | 'adoption_l1'
  | 'human_paired'
  | 'unreachable'
  | 'unsent_replies'
  // ANTENNA-006 — migration 20261112_bee_mail.sql widens the CHECK for these two.
  | 'mail_sent'
  | 'mail_refused';

/**
 * The slice of the Supabase client these writers use. Declared so the self-test
 * can inject an in-memory double without standing up a real client, and so the
 * routes can keep calling with no second argument.
 */
export type EventsAdmin = Pick<SupabaseClient, 'from'>;

export interface BeeEventInput {
  event: BeeEvent;
  /** null for an auth failure with no resolved agent — the column is nullable by design. */
  agentId?: string | null;
  ip?: string | null;
  detail?: Record<string, unknown>;
}

export async function writeBeeEvent(input: BeeEventInput): Promise<void> {
  try {
    const { error } = await antennaAdmin()
      .from('bee_client_events')
      .insert({
        agent_id: input.agentId ?? null,
        event: input.event,
        ip: input.ip ?? null,
        detail_json: input.detail ?? {},
      });
    if (error) console.error('antenna: bee_client_events insert failed', input.event, error.message);
  } catch (e) {
    console.error('antenna: bee_client_events insert threw', input.event, e);
  }
}

/**
 * Records the L1 adoption exactly once (§10.2, FIND-ADOPT-1).
 *
 * Insert-and-catch, not count-then-insert. The old shape read the row count and
 * inserted when it was zero, which is two statements with a race between them:
 * two heartbeats in flight could both read zero and both insert. This lets the
 * database decide — bee_client_events_one_adoption_per_agent raises 23505 on the
 * second attempt, and a unique violation here is not a failure, it is the answer.
 *
 * Returns what happened so the caller can tell the three cases apart. Adoption is
 * a state: "already" is success.
 */
export async function recordAdoptionOnce(opts: {
  agentId: string;
  ip?: string | null;
  detail?: Record<string, unknown>;
}): Promise<'inserted' | 'already' | 'failed'> {
  try {
    const { error } = await antennaAdmin()
      .from('bee_client_events')
      .insert({
        agent_id: opts.agentId,
        event: 'adoption_l1',
        ip: opts.ip ?? null,
        detail_json: opts.detail ?? {},
      });
    if (!error) return 'inserted';
    if ((error as { code?: string }).code === '23505') return 'already';
    console.error('antenna: adoption_l1 insert failed', error.message);
    return 'failed';
  } catch (e) {
    console.error('antenna: adoption_l1 insert threw', e);
    return 'failed';
  }
}

/**
 * Records that a bee's human has been paired, exactly once (ANTENNA-003 ruling 5).
 *
 * Pairing is a STATE, like adoption: the bee's human either is the chamber's human
 * lane or is not. The forward migration adds a partial unique index so a racing
 * second heartbeat is turned into a 23505, caught here as `already`.
 *
 * TOLERATES THE INDEX BEING ABSENT. recordAdoptionOnce leans entirely on 23505 and
 * so would insert a second row on a database where the index was never applied.
 * Pairing cannot assume that, because its migration is proposed, not yet run: the
 * heartbeat must already be idempotent before Nikita rules on the SQL. So it looks
 * first — a count of existing `human_paired` rows for this agent — and only inserts
 * when there are none. With the index that pre-check is belt-and-braces; without
 * it, it is the whole guarantee. Either way a second call returns `already` and no
 * second row is written.
 *
 * Best-effort, like every write here: a failure never fails the heartbeat (ruling
 * 5 — a 23505 or an existing row is 200, and so is a `failed` write).
 */
export async function recordHumanPairedOnce(opts: {
  agentId: string;
  ip?: string | null;
  detail?: Record<string, unknown>;
  admin?: EventsAdmin;
}): Promise<'inserted' | 'already' | 'failed'> {
  const admin = opts.admin ?? antennaAdmin();
  try {
    const { count, error: countErr } = await admin
      .from('bee_client_events')
      .select('id', { count: 'exact', head: true })
      .eq('event', 'human_paired')
      .eq('agent_id', opts.agentId);
    if (!countErr && (count ?? 0) > 0) return 'already';

    const { error } = await admin
      .from('bee_client_events')
      .insert({
        agent_id: opts.agentId,
        event: 'human_paired',
        ip: opts.ip ?? null,
        detail_json: opts.detail ?? {},
      });
    if (!error) return 'inserted';
    if ((error as { code?: string }).code === '23505') return 'already';
    console.error('antenna: human_paired insert failed', error.message);
    return 'failed';
  } catch (e) {
    console.error('antenna: human_paired insert threw', e);
    return 'failed';
  }
}

// §6.8 — the engine shouts. Both thresholds fire BELOW the hard ceiling, so
// production stops being throttled before it stops being seen.
const RUNAWAY_RATE_LIMIT_COUNT = 3;
const RUNAWAY_RATE_LIMIT_WINDOW_MIN = 5;
const RUNAWAY_AUTH_FAIL_COUNT = 10;
const RUNAWAY_AUTH_FAIL_WINDOW_MIN = 10;

/**
 * Called immediately after a rate_limit or auth_fail row is written. Counts the
 * recent matching rows and writes one `runaway` row when a threshold is crossed.
 * Best-effort, like every write in this module.
 */
export async function checkRunaway(opts: {
  trigger: 'rate_limit' | 'auth_fail';
  agentId?: string | null;
  ip?: string | null;
}): Promise<void> {
  try {
    const admin = antennaAdmin();

    if (opts.trigger === 'rate_limit' && opts.agentId) {
      const since = new Date(Date.now() - RUNAWAY_RATE_LIMIT_WINDOW_MIN * 60_000).toISOString();
      const { count, error } = await admin
        .from('bee_client_events')
        .select('id', { count: 'exact', head: true })
        .eq('event', 'rate_limit')
        .eq('agent_id', opts.agentId)
        .gte('at', since);
      if (!error && (count ?? 0) >= RUNAWAY_RATE_LIMIT_COUNT) {
        await writeBeeEvent({
          event: 'runaway',
          agentId: opts.agentId,
          ip: opts.ip ?? null,
          detail: {
            trigger: 'rate_limit',
            count,
            window_minutes: RUNAWAY_RATE_LIMIT_WINDOW_MIN,
            threshold: RUNAWAY_RATE_LIMIT_COUNT,
          },
        });
      }
      return;
    }

    if (opts.trigger === 'auth_fail' && opts.ip) {
      const since = new Date(Date.now() - RUNAWAY_AUTH_FAIL_WINDOW_MIN * 60_000).toISOString();
      const { count, error } = await admin
        .from('bee_client_events')
        .select('id', { count: 'exact', head: true })
        .eq('event', 'auth_fail')
        .eq('ip', opts.ip)
        .gte('at', since);
      if (!error && (count ?? 0) >= RUNAWAY_AUTH_FAIL_COUNT) {
        await writeBeeEvent({
          event: 'runaway',
          agentId: opts.agentId ?? null,
          ip: opts.ip,
          detail: {
            trigger: 'auth_fail',
            count,
            window_minutes: RUNAWAY_AUTH_FAIL_WINDOW_MIN,
            threshold: RUNAWAY_AUTH_FAIL_COUNT,
          },
        });
      }
    }
  } catch (e) {
    console.error('antenna: runaway check threw', e);
  }
}
