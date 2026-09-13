// lib/antenna/events.ts
// ----------------------------------------------------------------------------
// THE HIVE · Antenna — the bee_client_events writer (XI-1 v0.2.2 §6.12) and the
// runaway rule (§6.8).
//
// Writing an audit row must never be the reason a request fails: every write
// here is best-effort and swallows its own error after logging. The row is the
// record, not the control flow.
// ----------------------------------------------------------------------------
import { antennaAdmin } from './db';

/** The eleven values of the bee_client_events.event CHECK, verbatim from §9. */
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
  | 'unreachable'
  | 'unsent_replies';

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
