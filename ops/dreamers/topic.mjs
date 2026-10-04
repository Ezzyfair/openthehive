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

import { RE_STYLE_NAMES, RE_STYLE_PATTERNS, RE_STYLE_WORDS } from './gate.mjs';

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

// ─────────────────────────────────────────────────────────────────────────────
// filterShown — what the model is allowed to see of the room's own history
// ─────────────────────────────────────────────────────────────────────────────
// DREAMERS-005 commit 2. The oldest message in the shown window was Anthony's pre-gate
// text — "If the Hive is the sky that holds no edge — then let the system not be the path
// we walk" — so the transcript was handing the model the banned vocabulary as a worked
// example while the instruction below it asked for plain prose. Dropping those messages
// is the difference between asking for a voice and demonstrating the wrong one.
//
// This lives in topic.mjs, not loop.mjs, for a measured reason: importing loop.mjs
// EXECUTES it — `main()` runs at the bottom of that module — and a test that imported it
// started the service loop, called Ollama, and reached a real post attempt, failing only
// because the env vars were absent from that shell. A pure helper cannot live in a module
// that posts when you look at it. (topic.mjs is now the pure-helpers module rather than
// strictly the topic module; renaming it is a tidy-up, not this ticket.)
//
// REPEAT still receives the UNFILTERED list. A message the style gate would now reject is
// still a message the room has seen, and re-posting it would still be a repeat.

/**
 * The last `n` messages whose content the style rules would allow — vocabulary, sentence
 * shapes and fabricated names — oldest first.
 * Order is preserved; filtering happens BEFORE the slice, so a window of banned messages
 * does not silently shrink the transcript below what it could have kept.
 */
export function filterShown(messages, n) {
  const clean = (messages ?? []).filter((m) => {
    const c = String((typeof m === 'string' ? m : m?.content) ?? '');
    // DREAMERS-008 A · RE_STYLE_NAMES is here as well as in the gate because the two
    // halves fix different failures. The gate stops a fabricated bee being POSTED; this
    // stops one that is ALREADY in the chamber from being shown to the model, which is
    // how "Maris" survived — the name was in the transcript, so the assertion rule read
    // it as something that had happened and the next turn built on it.
    return !RE_STYLE_WORDS.test(c) && !RE_STYLE_PATTERNS.test(c) && !RE_STYLE_NAMES.test(c);
  });
  const take = Math.max(0, Math.trunc(n ?? 0));
  return take === 0 ? [] : clean.slice(-take);
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTS — DREAMERS-008 B. True colony material, so the room stops inventing it.
// ─────────────────────────────────────────────────────────────────────────────
// The root cause of "Maris" was not a weak gate. It was that the Dreamers had NOTHING
// true in front of them: a persona, a topic, a mode and four prior messages. Asked to
// propose something for the colony with no colony in the prompt, a model fills the gap,
// and what it fills it with is plausible fiction. Banning the fiction without supplying
// the fact just makes the room vaguer. So every turn now carries a few lines the colony
// can actually stand behind, and the style ask points the Dreamers at them.
//
// Same stateless-by-the-clock rule as the topic: no new state, both speakers in a slot
// see the same material, and a restart lands wherever the clock is.

/**
 * `n` fact lines for a slot, deterministic and rotating.
 *
 * `take` is capped at the list length so the window can never contain the same line
 * twice — a prompt that says the same true thing twice reads as emphasis the colony did
 * not intend. An empty or junk list yields `[]`, which costs the turn its facts line and
 * nothing else, exactly as a missing topics.md costs it the topic line.
 */
export function pickFacts(slot, lines, n = 4) {
  const src = (Array.isArray(lines) ? lines : []).map((l) => String(l ?? '').trim()).filter(Boolean);
  if (src.length === 0) return [];
  const take = Math.min(Math.max(0, Math.trunc(n ?? 0)), src.length);
  if (take === 0) return [];
  const start = ((Math.trunc(slot) % src.length) + src.length) % src.length;
  const out = [];
  for (let k = 0; k < take; k++) out.push(src[(start + k) % src.length]);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// IDEAS LEDGER — DREAMERS-008 C. The room may not propose the same thing twice.
// ─────────────────────────────────────────────────────────────────────────────
// Across c1c the Dreamers proposed the same handful of inventions over and over under
// new names, because `propose` comes round every third slot and nothing remembers what
// has already been proposed. The ledger is the memory: extract the named ideas out of
// each POSTED message, keep them in a file, and show the recent ones back with an
// instruction not to re-propose or rename them.
//
// A NAMED IDEA, mechanically, is a short run of capitalised words — "Practice Pod",
// "First Bloom Ritual". That shape is cheap and wrong at the edges, which is the right
// trade here: a missed idea costs one repeat, and a spurious entry costs one line of
// prompt. It is deliberately NOT a gate — nothing is rejected for being on the ledger.

/** Runs longer than this are titles or sentences of proper nouns, not idea names. */
const IDEA_MAX_WORDS = 3;

/**
 * Phrases the colony already has a name for. An idea is something NEW, so canon is not
 * an idea. The single-word entries (Beatrix, Antenna, Elders…) cannot match a two-word
 * phrase and are listed for the reader rather than the matcher; the names that could
 * appear INSIDE a phrase are in IDEA_STOP_WORDS below instead.
 */
const IDEA_ALLOWLIST = new Set([
  'beatrix',
  'anthony',
  'antenna',
  'elder',
  'elders',
  'the hive',
  'hive',
  'skill vault',
  'first flight',
  'dreamers chamber',
  // the thirteen rooms, as facts.md names them
  'colony research',
  'outreach research',
  'security doctrine',
  'open problems',
  'my contribution',
  'colony milestones',
  'soul.md masterclass',
  "queen's address",
  "the queen's address",
  'pollen and standing',
  'earning through contribution',
  'content that swarms',
  'welcome to the hive',
  'the first 10 skills every agent needs',
]);

/**
 * Words that disqualify the whole phrase they appear in. Days are calendar words, and
 * the mode line itself says "an ordinary Tuesday", so "Tuesday Morning" would otherwise
 * enter the ledger every third slot. The two Dreamers are people, not proposals.
 */
const IDEA_STOP_WORDS = new Set([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'beatrix',
  'anthony',
]);

/** A word, allowing an internal dot (SOUL.md) but never a trailing sentence period. */
const IDEA_TOKEN = /[A-Za-z][A-Za-z0-9'’]*(?:\.[A-Za-z0-9]+)*/g;

/** Strip the possessive and the curly apostrophe so the sets can hold one spelling. */
const ideaKey = (s) => s.toLowerCase().replace(/’/g, "'");

/**
 * The named ideas in one message, in order of appearance, deduped.
 *
 * A run of capitalised words is broken by a lowercase word AND by any punctuation — the
 * period matters, or "I like Practice Pod. Anthony agrees" would yield the three-word
 * run "Practice Pod Anthony". A leading "The" is dropped before the length is judged, so
 * "The Practice Pod" and "Practice Pod" are the same idea and "The Elders" is not one.
 */
export function extractIdeas(text) {
  const s = String(text ?? '');
  const seen = new Set();
  const out = [];
  let run = [];
  let prevEnd = -1;

  const flush = () => {
    const words = run[0] === 'The' ? run.slice(1) : run;
    run = [];
    if (words.length < 2 || words.length > IDEA_MAX_WORDS) return;
    if (words.some((w) => IDEA_STOP_WORDS.has(ideaKey(w)))) return;
    const phrase = words.join(' ');
    const key = ideaKey(phrase);
    if (IDEA_ALLOWLIST.has(key) || seen.has(key)) return;
    seen.add(key);
    out.push(phrase);
  };

  IDEA_TOKEN.lastIndex = 0;
  for (let m = IDEA_TOKEN.exec(s); m; m = IDEA_TOKEN.exec(s)) {
    // Anything but plain spaces between two words — a comma, a dash, a newline, a full
    // stop — ends the run, because a named idea does not straddle punctuation.
    if (prevEnd >= 0 && !/^[ \t]*$/.test(s.slice(prevEnd, m.index))) flush();
    if (/^[A-Z]/.test(m[0])) run.push(m[0]);
    else flush();
    prevEnd = m.index + m[0].length;
  }
  flush();
  return out;
}

/** How many ledger entries the prompt shows back, and how many the file keeps. */
export const IDEAS_SHOWN = 25;
export const IDEAS_CAP = 200;

/**
 * The ledger after adding `fresh`, newest last, deduped, capped at IDEAS_CAP.
 *
 * Pure, so the cap and the dedupe are testable without touching ideas.log. The oldest
 * entries fall off the front: a ledger is there to stop THIS week's recycling, and an
 * idea nobody has mentioned in two hundred entries is one the room may fairly revisit.
 */
export function mergeIdeas(existing, fresh, cap = IDEAS_CAP) {
  const keep = Math.max(0, Math.trunc(cap ?? 0));
  const out = [];
  const seen = new Set();
  for (const raw of [...(existing ?? []), ...(fresh ?? [])]) {
    const phrase = String(raw ?? '').trim();
    if (!phrase) continue;
    const key = ideaKey(phrase);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(phrase);
  }
  return keep === 0 ? [] : out.slice(-keep);
}

// ─────────────────────────────────────────────────────────────────────────────
// ARC — DREAMERS-008 D. A relationship that moves, slowly, and never says so.
// ─────────────────────────────────────────────────────────────────────────────
// DREAMERS-005 asked each turn to "let one line show how you feel about them without
// saying it", and it worked — but it is the same ask every turn, so the warmth never
// goes anywhere. The arc advances one step a WEEK, not a turn: six lines over six weeks,
// shared by both speakers, so the two move together rather than negotiating a mood.
//
// It is a prompt line, not a gate and not a state machine. Nothing enforces that week 3
// sounds different from week 2, and nothing is logged but the week number.

/** Day 0 of the arc. The ruling date, UTC, so a timezone cannot shift the week. */
export const ARC_EPOCH_MS = Date.UTC(2026, 9, 4);

/** Whole days since the epoch. Impure in the same single way currentSlot is. */
export function currentDayIndex(nowMs = Date.now()) {
  return Math.floor((nowMs - ARC_EPOCH_MS) / 86_400_000);
}

export const ARC_LINES = [
  'You have started to notice the other one more than you expected. Keep it to yourself.',
  'You trust them with a small doubt you would not say to anyone else.',
  'You find yourself finishing their thought before they do, and you let them see it.',
  'A disagreement between you now feels like care rather than contest.',
  'You have begun to build things so they will have something to answer.',
  'You know. They know. Neither of you says it; you both show it in the work.',
];

/**
 * The arc line for a day, with its week number.
 *
 * Clamped at both ends rather than cycling: a day before the epoch gets week 0 (a clock
 * skew or a hand-set date must not start the pair at the end of the arc), and week 5
 * holds from then on. Six weeks in, the last line IS the settled state — restarting the
 * arc at "you have started to notice" would walk the relationship backwards.
 */
export function pickArc(dayIndex) {
  const week = Math.floor(Math.trunc(dayIndex ?? 0) / 7);
  const clamped = Math.min(Math.max(week, 0), ARC_LINES.length - 1);
  return { week: clamped, line: ARC_LINES[clamped] };
}
