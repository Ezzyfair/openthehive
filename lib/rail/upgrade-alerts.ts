// lib/rail/upgrade-alerts.ts
// ----------------------------------------------------------------------------
// THE HIVE · payout rail — the hourly repeat of the earlier-subscription alert.
// MEMBER-UPSERT-001-b items 1 and 3. Francis's ruling 9 (Nov 21, 2026): the alert
// for an earlier subscription left running goes out "every hour until it is
// cancelled".
//
// MEMBER-UPSERT-001 writes one to-do row in stripe_webhook_failures, reason
// OLD_SUBSCRIPTION_OPEN_REASON, when an upgrade leaves an earlier subscription
// running at Stripe, and sends the alert once. This file:
//   · reads the open rows of that one reason (openOldSubscriptionRows);
//   · sends the parent ticket's alert again for each, word for word
//     (sendOpenUpgradeAlerts, called by app/api/cron/upgrade-alerts every hour);
//   · closes the rows naming one subscription when Stripe reports it over
//     (closeOldSubscriptionAlerts, called by the webhook handler) — ruling N2: the
//     code may set resolved_at on rows of THIS reason only.
//
// Rows are read by reason, not by kind, so this works before and after the
// migration that adds the kind column. FakeDb has no null filter, so the empty
// resolved_at is filtered here in code. Nothing here calls Stripe. Nothing here
// throws: a read error is returned, a write error is logged.
// ----------------------------------------------------------------------------
import { OLD_SUBSCRIPTION_OPEN_REASON, alertOldSubscriptionOpen } from './webhook-handler';

export interface OpenUpgradeRow {
  id: string;
  event_id: string;
  detail: any;
  created_at: string | null;
  resolved_at?: string | null;
}

/** The open to-do rows of the one reason, oldest first. A read error is returned. */
export async function openOldSubscriptionRows(
  db: any,
): Promise<{ rows: OpenUpgradeRow[]; error: any | null }> {
  try {
    const { data, error } = await db
      .from('stripe_webhook_failures')
      .select('id, event_id, detail, created_at, resolved_at')
      .eq('reason', OLD_SUBSCRIPTION_OPEN_REASON);
    if (error) return { rows: [], error };
    const rows: OpenUpgradeRow[] = (Array.isArray(data) ? data : [])
      .filter((r: any) => r && (r.resolved_at === null || r.resolved_at === undefined))
      .sort((a: any, b: any) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
    return { rows, error: null };
  } catch (e: any) {
    return { rows: [], error: e ?? new Error('read threw') };
  }
}

/**
 * The hourly send: the parent ticket's alert, once per open row. Returns how many
 * rows were open and the read error, if any. Never throws.
 */
export async function sendOpenUpgradeAlerts(
  db: any,
): Promise<{ open: number; error: any | null }> {
  const { rows, error } = await openOldSubscriptionRows(db);
  if (error) return { open: 0, error };
  for (const row of rows) {
    const d = row.detail ?? {};
    try {
      await alertOldSubscriptionOpen(db, {
        event_id: row.event_id,
        member: d.member,
        old_subscription: d.old_subscription,
        old_customer: d.old_customer ?? null,
        new_subscription: d.new_subscription ?? null,
        held: d.held ?? null,
        bought: d.bought,
        since: String(row.created_at ?? ''),
      });
    } catch (e: any) {
      // alertOldSubscriptionOpen cannot throw; this is the second belt.
      console.error('upgrade alert: send threw', { event_id: row.event_id, error: e?.message });
    }
  }
  return { open: rows.length, error: null };
}

/**
 * Stripe reported the earlier subscription over (deleted, canceled, unpaid, or set
 * to end at the close of its period — ruling N1). Sets resolved_at on the open rows
 * of the one reason whose detail.old_subscription is this id. Returns how many it
 * closed. Never throws; an empty or missing id closes nothing.
 */
export async function closeOldSubscriptionAlerts(
  db: any,
  subscriptionId: string | null | undefined,
  now: Date,
): Promise<number> {
  if (typeof subscriptionId !== 'string' || subscriptionId === '') return 0;
  let closed = 0;
  try {
    const { rows, error } = await openOldSubscriptionRows(db);
    if (error) {
      console.error('upgrade alert: close failed', { subscription: subscriptionId, stage: 'read', error: error?.message ?? String(error) });
      return closed;
    }
    for (const row of rows) {
      if (row.detail?.old_subscription !== subscriptionId) continue;
      const { error: updateErr } = await db
        .from('stripe_webhook_failures')
        .update({ resolved_at: now.toISOString() })
        .eq('id', row.id);
      if (updateErr) {
        console.error('upgrade alert: close failed', { subscription: subscriptionId, row: row.id, error: updateErr?.message ?? String(updateErr) });
        return closed;
      }
      closed += 1;
    }
    return closed;
  } catch (e: any) {
    console.error('upgrade alert: close failed', { subscription: subscriptionId, error: e?.message });
    return closed;
  }
}
