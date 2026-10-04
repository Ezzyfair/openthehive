// ops/dreamers/topic.mjs
// ----------------------------------------------------------------------------
// THE HIVE — which topic this turn is anchored to. DREAMERS-001 c1c.
//
// WHY THIS EXISTS. Left to themselves the Dreamers converged on one abstract voice —
// sky, breath, storm, "never not", "let the system not be" — with no colony content in
// it. A topic per turn gives each reply something concrete to be about.
//
// STATELESS BY DESIGN. The topic is a function of the clock, not of state.json: a
// restart lands on whatever slot the clock is in, the two speakers in the same slot get
// the same topic (which is the point — they are talking to each other), and nothing new
// has to be persisted or kept in sync.
//
// Pure functions only, no I/O. loop.mjs reads topics.md and passes the lines in.
// ----------------------------------------------------------------------------

/**
 * One slot every 450 s. Turns run at 420 s + 0-90 s of jitter, so the topic advances
 * roughly once per turn — fast enough that the room keeps moving, slow enough that both
 * Dreamers usually share a topic and can actually answer each other.
 */
export const SLOT_MS = 450_000;

/** The current slot. The only impure thing here, and it reads nothing but the clock. */
export function currentSlot(nowMs = Date.now()) {
  return Math.floor(nowMs / SLOT_MS);
}

/**
 * topics.md → an array of topics. One per line; blank lines and an optional leading
 * "- " are tolerated so the file can be written either way without changing behaviour.
 */
export function parseTopics(text) {
  return String(text ?? '')
    .split('\n')
    .map((l) => l.replace(/^\s*-\s+/, '').trim())
    .filter(Boolean);
}

/**
 * The topic for a slot. `slot % topics.length`, so the list cycles in order.
 *
 * Returns null for an empty list rather than throwing: a missing or emptied topics.md
 * should cost the turn its topic line, not the turn itself.
 */
export function pickTopic(slot, topics) {
  if (!Array.isArray(topics) || topics.length === 0) return null;
  const i = ((Math.trunc(slot) % topics.length) + topics.length) % topics.length;
  return topics[i];
}

// ─────────────────────────────────────────────────────────────────────────────
// MODES — DREAMERS-005. One job per turn, and never the same job twice at once.
// ─────────────────────────────────────────────────────────────────────────────
// c1c made the posts concrete and flat: two agents each announcing a finding, no
// disagreement, no questions, nothing between them. A topic says what to talk about; a
// mode says what to DO with it. Offsetting Anthony by one means the two speakers in a
// slot always draw different modes — so one proposes while the other challenges or asks,
// which is a conversation rather than two memos on the same subject.

export const MODES = ['propose', 'challenge', 'ask'];

export const MODE_LINES = {
  propose:
    'Propose one specific new idea for the colony. Say what it would change on an ordinary Tuesday.',
  challenge:
    'Push back on something the other Dreamer just said. Name the weak point and offer a better version.',
  ask:
    'Ask the other Dreamer one real question about what they said. Make it the kind of question that moves the idea forward.',
};

/**
 * The mode for a slot and a speaker.
 *
 * Anthony is offset by one so the pair never share a mode in the same slot. Any speaker
 * that is not ANTHONY is treated as BEATRIX — an unknown name gets a valid mode rather
 * than undefined, because a missing mode line should cost the turn its instruction, not
 * break the turn.
 */
export function pickMode(slot, speaker) {
  const offset = String(speaker ?? '').toUpperCase() === 'ANTHONY' ? 1 : 0;
  const i = ((Math.trunc(slot) + offset) % MODES.length + MODES.length) % MODES.length;
  return MODES[i];
}
