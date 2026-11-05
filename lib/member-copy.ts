// lib/member-copy.ts
// ----------------------------------------------------------------------------
// THE HIVE — the member pages' fixed sentences and the small pure helpers that
// build the rest (MEMBER-002 items 2, 4, 5, 6).
//
// Pure on purpose: the login page and the chamber view are client components and
// must not pull in lib/member-auth.ts (node:crypto). The tests read the same
// constants the pages render, so a copy change cannot drift from its test.
// ----------------------------------------------------------------------------

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
