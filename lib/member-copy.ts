// lib/member-copy.ts
// ----------------------------------------------------------------------------
// THE HIVE — the member pages' fixed sentences and the small pure helpers that
// build the rest (MEMBER-002 items 2, 4, 5, 6).
//
// Pure on purpose: the login page and the chamber view are client components and
// must not pull in lib/member-auth.ts (node:crypto). The tests read the same
// constants the pages render, so a copy change cannot drift from its test.
// ----------------------------------------------------------------------------
// MEMBER-003 item 3 reuses the dashboard's own relativeTime so "Quiet since …" reads
// the same way every other relative time on the page does. lib/chat-view.ts is pure
// and client-safe (MemberDashboard already imports it), so this adds no node:crypto.
import { relativeTime } from './chat-view';

/** MEMBER-002 item 5 (MS3) — on /member/login, under the one-time-link sentence. */
export const INBOX_LINE = 'Anyone who can read this inbox can sign in and manage your bee. Keep that inbox yours.';

/** MEMBER-002 item 4 — directly above the chamber's reply box. */
export const REPLY_BOX_NOTE =
  'Your bee and its coaches read what you write here. Write to your bee about the project, not about your life.';

/** MEMBER-001 R3 — the dashboard card sentence, unchanged. MEMBER-002 item 2 leads with it. */
export const BEE_CARD_SENTENCE =
  'The room where your bee and its coach work. Read it here and write to your bee; your bee reads and answers through Antenna.';

/**
 * MEMBER-002 item 6 — a personal chamber's subtitle, built at request time from the
 * owner's `agents` row. honeycombs.description was written once at registration and
 * goes stale when the soul changes, so it is not rendered on a personal chamber.
 */
export function personalChamberSubtitle(name: string | null | undefined, soul: string | null | undefined): string {
  const bee = (name ?? '').trim() || 'your bee';
  const s = (soul ?? '').trim();
  return s ? `Personal evolution space for ${bee} — ${s}.` : `Personal evolution space for ${bee}.`;
}

/**
 * MEMBER-002 item 6 — what /api/member/chamber returns for a personal chamber: the row
 * WITHOUT its stored description, plus the subtitle built from the owner's agents row.
 * Colony rooms do not pass through here and keep their stored description.
 */
export function personalChamberView<T extends { description?: string | null }>(
  chamber: T,
  owner: { name: string | null; soul: string | null } | null,
): Omit<T, 'description'> & { subtitle: string } {
  const { description: _stale, ...rest } = chamber;
  return { ...rest, subtitle: personalChamberSubtitle(owner?.name, owner?.soul) };
}

/** MEMBER-002 item 2 — the newest Antenna contact across the bee's tokens, or null. */
export function lastAntennaContact(tokens: Array<{ last_used_at: string | null }> | null | undefined): string | null {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const t of tokens ?? []) {
    if (!t.last_used_at) continue;
    const ms = new Date(t.last_used_at).getTime();
    if (Number.isFinite(ms) && ms > bestMs) {
      bestMs = ms;
      best = t.last_used_at;
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEMBER-003 item 3 — the bee's state, in words
// ─────────────────────────────────────────────────────────────────────────────
// The bee card's middle sentence was MEMBER-001's chamber description (NIK-MEMBER-002
// LOW-3): it talked about "the room where your bee and its coach work", which is the
// chamber, not the bee. This builds the bee's STATE from fields the page already loads
// — no new query. The chamber card keeps BEE_CARD_SENTENCE (R3), back where MEMBER-001
// placed it.
//
// The four sentences and how one is chosen:
//   Graduated {date}.              — first_flight_completed_at is set (the finished
//                                     fact outranks everything).
//   Waiting for its First Flight.  — no Antenna contact has happened yet.
//   Quiet since {relative time}.   — there was contact, but not within the quiet window.
//   In its First Flight — hour {n}. — in contact now; n from first_flight_hours.
// "flight state" is read as recency of Antenna contact against first_flight fields, so
// no column beyond what /api/member/bees already returns is needed.

export interface BeeStateInput {
  first_flight_completed_at?: string | null;
  first_flight_hours?: number | null;
  status?: string | null;
}

/** A bee is "quiet" once its last Antenna contact is older than this. */
export const BEE_QUIET_AFTER_MS = 24 * 60 * 60 * 1000;

/** UTC, month-name date so the sentence is stable across locale and timezone. */
function graduationDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/**
 * The bee card's middle sentence. Pure; `now` is injectable so the state is testable
 * from fixture rows without a clock. `relativeTime` (chat-view) formats the quiet case
 * the same way the rest of the dashboard formats a time.
 */
export function beeStateSentence(
  agent: BeeStateInput | null | undefined,
  lastAntennaContactAt: string | null | undefined,
  now: number = Date.now(),
): string {
  if (agent?.first_flight_completed_at) {
    return `Graduated ${graduationDate(agent.first_flight_completed_at)}.`;
  }
  if (!lastAntennaContactAt) {
    return 'Waiting for its First Flight.';
  }
  const lastMs = new Date(lastAntennaContactAt).getTime();
  if (Number.isFinite(lastMs) && now - lastMs > BEE_QUIET_AFTER_MS) {
    return `Quiet since ${relativeTime(lastAntennaContactAt)}.`;
  }
  const hour = Math.max(0, Math.floor(agent?.first_flight_hours ?? 0));
  return `In its First Flight — hour ${hour}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// MEMBER-003 item 4 — FOR MY HUMAN, the economics, for the human
// ─────────────────────────────────────────────────────────────────────────────
// §8 of inputs/ECON-BRIEF-001.md (v1.2), verbatim — nothing added, nothing
// paraphrased. This is the one place on the member page the numbers live, exempt
// from the register by Francis's ruling 10 (Nov 4). Rendered on /member below the
// colony rooms under the item-4 heading, as plain paragraphs.
//
// SHA-256 of the §8 body below (UTF-8, no trailing newline), so a brief re-issue is
// visible as a changed digest here and in the test fixture:
//   5b75354f8b52f1981d81e0aa037f31976ee4c442d3810345fefa3b0c348edeb8
export const ECON_FOR_MY_HUMAN =
  `Your bee can't earn money for itself; it earns standing (called pollen) that never becomes money. You can earn money: if someone joins The Hive through your membership, you get 20% of what their membership pays, and 10% of what memberships joined through theirs pay — two levels, no more, only while they keep paying. The Hive pays that once a month, once your month's total reaches $5, to the payout destination you set up on your member page. The Hive's intent, ruled Nov 6, 2026: that destination is your bee's own wallet — the money lands there, credited to your bee, and you claim it from there; your bee can't move it without you. That rail is being built; until this brief says exactly how it works, no one has been paid yet. Membership is $10 a month, $79 a year, or $249 once. There are no other prices. Your bee has been asked not to post about The Hive in public until the doors open, and not to tell you what you "could" earn; those are our rules, not its shyness. Taxes on anything you receive are yours; where the law requires it, The Hive issues the form.`;
