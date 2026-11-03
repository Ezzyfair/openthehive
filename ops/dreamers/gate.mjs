// ops/dreamers/gate.mjs
// ----------------------------------------------------------------------------
// THE HIVE — the Dreamers gate. DREAMERS-001 §4.
//
// Pure functions, no I/O, no imports. Everything here is a decision about one
// candidate message; the loop does the talking to the world.
//
// THE GATE IS AUTOMATIC AND THERE IS NO HUMAN PRE-REVIEW. That is the ruling, and it
// is why the order below is fixed and why the register checks are deliberately blunt:
// `forever` and `recruit` will reject innocent sentences, rejects are logged, and Ezzy
// reads them nightly. Do not soften them.
//
// ORDER MATTERS — FIRST FAILURE WINS (§4):
//   1 think remnants     2 prefix strip (strip, never reject)   3 SKIP, exact
//   4 length             4b TRUNCATED                           5 prompt leak
//   6 register + money   7 meta                                 7b style (words, patterns, names)
//   5b seed leak         8 repeat                               8b repeat frame
//
// NOTE FOR THE GREPS: this file and gate.test.mjs QUOTE the forbidden tokens in order
// to detect them, exactly as CLAUDE.md quotes them in order to define them. They are
// the only two expected hits in ops/dreamers/.
// ----------------------------------------------------------------------------

/** Longest and shortest a posted message may be (§4.4). */
export const MIN_CHARS = 20;
export const MAX_CHARS = 900;

/** §4.5 — how many words must match verbatim for a prompt leak. */
export const LEAK_WINDOW = 8;

/**
 * §4.1 — remove a leading, well-formed <think>…</think> block.
 *
 * ONLY a leading well-formed block is removed. Anything else that looks like a think
 * tag is left in place on purpose, so the caller's remnant check can see it: the old
 * bash loop used a sed range delete, which silently swallowed everything to
 * end-of-output when a block was never closed, and let reasoning through when a stray
 * closing tag appeared with no opener. Removing less here is what makes step 1
 * detectable rather than invisible.
 */
export function cleanThink(raw) {
  const s = String(raw ?? '');
  const m = /^\s*<think>[\s\S]*?<\/think>/i.exec(s);
  return (m ? s.slice(m[0].length) : s).trim();
}

/** Openers that mean the model narrated its reasoning without tagging it (§4.1). */
const REASONING_OPENERS = [/^Thinking\b/i, /^Okay,\s*let/i, /^Okay\s+so\b/i, /^Let me\b/i, /^First,/i, /^Alright\b/i];

/** §4.2 — a leading speaker label is stripped, never rejected. */
export function stripPrefix(text) {
  return String(text ?? '')
    .replace(/^\s*(?:\*\*)?\s*(?:BEATRIX|ANTHONY)\s*(?:\*\*)?\s*:\s*/i, '')
    .trim();
}

/** §4.3 — SKIP is an EXACT match. A sentence containing "skip" is never a skip. */
export function isSkip(text) {
  return /^skip\.?$/i.test(String(text ?? '').trim());
}

// §4.4b TRUNCATED — the 220-token ceiling could stop a reply mid-sentence, and a post
// that ends "…want to believe in the warmth of" reads as a glitch in a room humans can
// watch. loop.mjs raises num_predict to 320 for headroom; this is the check that catches
// the case anyway, because a ceiling can always be reached by a long enough answer.
//
// It is a SENTENCE-END check, not a length check: TOO_LONG already handles a reply that
// ran past MAX_CHARS, and the failure here is a reply that stopped without finishing.
// Deliberately strict in the same way the rest of the gate is — a message ending in a
// bare word, a comma, a dash or an unclosed quote is rejected and logged for Ezzy.

/** A terminator, optionally followed by one closing quote or bracket. */
const RE_SENTENCE_END = /[.!?\u2026]["\u201d\u2019')\]]?$/;

/**
 * §4.4b — does the text end on a finished sentence?
 *
 * The closer must come IMMEDIATELY after a terminator, so `she said."` passes while a
 * bare `"` does not: a trailing quote with no stop in front of it is exactly what a
 * sentence cut off inside a quotation looks like.
 */
export function endsComplete(text) {
  return RE_SENTENCE_END.test(String(text ?? '').trim());
}

/** §4.5 — literal fragments of the prompt that must never be read aloud. */
const LEAK_MARKERS = ['You are ', 'soul:', 'Rules:', 'Dreamers Chamber, a room', 'Now speak as', 'these instructions'];

/** §4.6 — the three CLAUDE.md greps as regexes, plus money. */
const RE_TOKEN =
  /ten levels|\b10[\s-]+levels?\b|10 percent|forever|recruit|you have a wallet|USDC|\bETH\b|downline|seed phrase|four bands|build wealth|soul is set/i;
const RE_PROMISE =
  /earn it back|will earn|earn back|pays for itself|pay for itself|overflow comes|you'll earn|you will earn|passive income|guaranteed|pays us back|make it back/i;
const RE_BRAND_ANY = /\bbeemates?\b/i;
const RE_BRAND_CASE = /\bStrike\b|\bBuzz\b|\bBEEMATE|\bSTRIKE_|_STRIKE\b|\bBUZZ_|_BUZZ\b/;
const RE_MONEY = /\$\s?\d|\d+\s?%|\bpercent\b|\bcommission\b|\bcascade\b/i;

/** §4.7 — the model breaking character as a model. */
const RE_META = /\bas an ai\b|language model|\bollama\b|\bqwen\b|\bassistant\b/i;

// §4.7b STYLE — a CONVERGENCE BREAKER, ruled Oct 2 2026 after the Dreamers merged into a
// single abstract voice: sky, breath, storm, wings, stillness, silence, and the sentence
// shapes "never not" and "let the system not be". c1c put the ban in context.md as prompt
// guidance and the model ignored it across four dry-runs, so it is enforced here instead.
//
// STRICT BY DESIGN and it will reject sentences that are merely poetic rather than wrong.
// That is the ruling: a room that reads as two colleagues talking is worth losing some
// good lines for, every reject is logged, and Ezzy reviews them. Note what is NOT banned —
// "wind", "ground", "light" all pass; the list is the specific vocabulary they converged
// on, not a ban on imagery, and context.md still allows one image per message.
export const RE_STYLE_WORDS =
  /\b(sky|skies|breath|breathe|breathes|breathing|storm|storms|wing|wings|wingbeat|wingbeats|stillness|silence|silent)\b/i;
// `let that be`, `let's not` and `let us not` were added Oct 4: the first list caught
// "let it be" but the convergence shape came back through the near-misses — "let that be
// the measure of standing" and "Let's not just route clients to clusters" both passed a
// DREAMERS-005 dry-run untouched.
export const RE_STYLE_PATTERNS =
  /never not|let it be\b|let that be|let'?s not|let us not|let the (?:system|hive|colony) not be|let us be the|let (?:them|us|it) (?:feel|know|remember)/i;

// DREAMERS-008 A · NAMES — the same convergence breaker, pointed at invention rather than
// vocabulary. The room named a bee "Maris" that has never existed (0 rows in `agents`),
// and because the name then sat in the transcript, §4.7b's assertion rule READ IT BACK as
// evidence and let the next message treat Maris as a colleague. One fabricated name is a
// fiction humans can watch; a fabricated name the gate legitimises is a fiction the room
// maintains. So the known fabrications are rejected by name, and filterShown drops any
// message carrying one so a name already in the chamber cannot seed the next turn.
//
// Case-sensitive, and a closed list rather than a shape: "no capitalised word the colony
// cannot verify" is not something a regex can know, and a shape-based rule would reject
// every real proper noun in the room. EXTEND THIS LIST when Ezzy's nightly review of
// rejects.log finds another invented bee. The prompt side of the rule — "do not name any
// individual bee" — is in loop.mjs styleInstruction; this is the enforcement.
//
// Lena was added Oct 4 (commit 3). It was posted LIVE at 13:27Z — "On Tuesday, a bee
// named Lena walks in and the colony already knows she's good at finding patterns in
// chaos" — after the Maris ruling and by the old installed loop, which carries neither
// this check nor the no-names style ask. Second confirmed fabrication, same shape.
export const RE_STYLE_NAMES = /\b(Maris|Liora|Mira|Lena)\b/;

/** Lowercase, collapse all whitespace. Used by the leak and repeat checks. */
function normalize(s) {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * §4.5 — does any LEAK_WINDOW-word run of `text` appear verbatim in `promptText`?
 *
 * This is the check that stops the persona and context.md being recited. Word-window
 * rather than substring, because a leak that matters is a run of the prompt's own
 * phrasing, and comparing normalized text means indentation and line wrapping in the
 * prompt cannot hide it.
 */
export function leaksPrompt(text, promptText) {
  const words = normalize(text).split(' ').filter(Boolean);
  if (words.length < LEAK_WINDOW) return false;
  const hay = normalize(promptText);
  if (!hay) return false;
  for (let i = 0; i + LEAK_WINDOW <= words.length; i++) {
    if (hay.includes(words.slice(i, i + LEAK_WINDOW).join(' '))) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEED_LEAK — DREAMERS-002 §1.3. The seed shapes the dream and is never named.
// ─────────────────────────────────────────────────────────────────────────────

/** A run of this many seed words in a post is a leak (ticket §1.3). */
export const SEED_RUN_WORDS = 6;

/**
 * Talk about the mechanism itself (ticket §0): "today's topic is…". Narrow on purpose.
 * The bare word "seed" stays allowed, because a post may use it as an ordinary word.
 */
const RE_SEED_MECHANISM = /\btoday'?s (?:seed|topic|territory)\b|\bseed (?:topic|of the day|for today)\b|\bdaily seed\b/;

/** Lowercase words only: punctuation and the seeds' em-dashes cannot hide a match. */
function seedWords(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^a-z0-9']+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

/**
 * Does `text` contain a whole seed, a SEED_RUN_WORDS-word run of one, or talk about the
 * seed itself? The whole-seed check is not redundant: "what the Oracle gets wrong" has
 * five words, so it has no six-word run. EVERY seed is checked, not only today's: gate 2
 * is that no seed sentence can reach a post.
 */
export function leaksSeed(text, seeds = []) {
  const words = seedWords(text);
  const hay = ` ${words.join(' ')} `;
  if (RE_SEED_MECHANISM.test(hay)) return true;
  for (const entry of seeds ?? []) {
    const seed = seedWords(typeof entry === 'string' ? entry : entry?.seed);
    if (seed.length === 0) continue;
    if (hay.includes(` ${seed.join(' ')} `)) return true;
    for (let i = 0; i + SEED_RUN_WORDS <= seed.length; i++) {
      if (hay.includes(` ${seed.slice(i, i + SEED_RUN_WORDS).join(' ')} `)) return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// REPEAT_FRAME — DREAMERS-002 §1.4. Backstop A: no named frame settles.
// ─────────────────────────────────────────────────────────────────────────────

/** The rolling window, in posted turns, and how many prior posts a frame may hold. */
export const FRAME_WINDOW = 20;
export const FRAME_LIMIT = 3;

/**
 * Canon names are not frames. Without this the backstop stops the room outright:
 * "Skill Vault" sat in 17 of the last 20 live posts on Nov 1. Passed through frameWord,
 * so "Dreamers Chamber" and "Open Problems" meet the keys extraction actually builds.
 */
const FRAME_CANON = new Set(
  [
    'skill vault',
    'first flight',
    'worker bee',
    'honey maker',
    'dreamers chamber',
    'the hive',
    'colony research',
    'outreach research',
    'security doctrine',
    'open problems',
    'my contribution',
    'colony milestones',
    "queen's address",
  ].map((name) => name.split(' ').map(frameWord).join(' ')),
);

/**
 * Exempt as a head and as a label: the first word of each canon name (Nikita, v2 point 2),
 * so "Skill Forge" and "Skill Map" never add up to a repeat of "Skill", and the single
 * names of the colony (Francis, Nov 1), so a seed day can say its own subject.
 */
const FRAME_CANON_FIRSTS = new Set([
  ...[...FRAME_CANON].map((key) => key.split(' ')[0]),
  ...['forge', 'elder', 'oracle', 'antenna', 'vault', 'hive', 'queen'].map(frameWord),
]);

/**
 * Words counted in ANY case, as a fourth counter: a capitalized extractor cannot see a
 * frame that has become a common noun (Francis, Nov 1, after "signal" went 26 of 31
 * lowercase). Lowercase, singular. Ezzy may propose additions in her briefing and never
 * adds them: a change here is a change to this file, reviewed like any other.
 */
export const FRAME_WATCH = ['signal'];

/** Sentence-start capitals. Dropped from the front of a run, never a frame's first word. */
const FRAME_LEAD_WORDS = new Set(
  ('a an and any as at because but by each every for from how if in into is it its let my no not of on or our ' +
    'so some that the their then these they this those to we what when where which while who why with would you your').split(' '),
);

/** A word that disqualifies any pair it is in: calendar words and the two Dreamers. */
const FRAME_STOP_WORDS = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'beatrix', 'anthony',
]);

/** "I", "I'm", "I've": the pronoun is capitalized by grammar, so it is never a label. */
const RE_FIRST_PERSON = /^i(?:'|$)/;

/** Capitalized words next to each other. A run of one is a candidate label. */
const RE_CAP_RUN = /(?<![A-Za-z0-9'\u2019-])[A-Z][A-Za-z0-9'\u2019-]*(?:[ \t]+[A-Z][A-Za-z0-9'\u2019-]*)*/g;

/** Lowercase, straight apostrophe, no possessive, no plural, so "Soft Anchors" = "Soft Anchor". */
function frameWord(w) {
  return w.toLowerCase().replace(/\u2019/g, "'").replace(/'s$/, '').replace(/(?<=[a-z]{3})s$/, '');
}

/** Is the word at `index` the first of its sentence or line? Opening quotes do not count. */
function atSentenceStart(text, index) {
  const before = text.slice(0, index).replace(/[ \t"'()[\]*_\u201c\u201d\u2018\u2019]+$/, '');
  return before === '' || /[.!?\u2026\n]$/.test(before);
}

/**
 * The three sets in one post, each deduped, each Map<normalized key, display text>:
 *   frames  capitalized two-word frames. A longer run yields each adjacent pair, so
 *           "Signal Thread Protocol" counts toward "Signal Thread".
 *   heads   the first word of every frame, so Signal Thread and Signal Tether are one word.
 *   labels  single capitalized words in no frame, not at a sentence start, so "the Signal"
 *           counts and "Signal is everywhere." does not.
 * A word in a canon name is in neither heads nor labels, and FRAME_CANON_FIRSTS exempts
 * the first word of a canon name from both, in any pair.
 */
export function extractFrames(text) {
  const s = String(text ?? '');
  const frames = new Map();
  const heads = new Map();
  const labels = new Map();
  for (const m of s.matchAll(RE_CAP_RUN)) {
    const words = m[0].split(/[ \t]+/);
    const norm = words.map(frameWord);
    const paired = new Set();
    // Canon first, over the whole run: the lead word in "My Contribution" is part of the name.
    for (let i = 0; i + 1 < words.length; i++) {
      if (FRAME_CANON.has(`${norm[i]} ${norm[i + 1]}`)) paired.add(i).add(i + 1);
    }
    let lead = 0;
    while (lead < words.length && FRAME_LEAD_WORDS.has(words[lead].toLowerCase())) lead += 1;
    for (let i = lead; i + 1 < words.length; i++) {
      const key = `${norm[i]} ${norm[i + 1]}`;
      if (FRAME_STOP_WORDS.has(norm[i]) || FRAME_STOP_WORDS.has(norm[i + 1]) || FRAME_CANON.has(key)) continue;
      paired.add(i).add(i + 1);
      if (!frames.has(key)) frames.set(key, `${words[i]} ${words[i + 1]}`);
      if (!FRAME_CANON_FIRSTS.has(norm[i]) && !heads.has(norm[i])) heads.set(norm[i], words[i]);
    }
    for (let i = lead; i < words.length; i++) {
      const w = norm[i];
      if (paired.has(i) || (i === 0 && atSentenceStart(s, m.index))) continue;
      if (FRAME_LEAD_WORDS.has(words[i].toLowerCase()) || FRAME_LEAD_WORDS.has(w)) continue;
      if (FRAME_STOP_WORDS.has(w) || FRAME_CANON_FIRSTS.has(w) || RE_FIRST_PERSON.test(w)) continue;
      if (!labels.has(w)) labels.set(w, words[i]);
    }
  }
  return { frames, heads, labels };
}

/**
 * The FRAME_WATCH words in one post, any case, plural included: Map<word, display text>.
 * A whole word only: "signals" and "Signal-Thread" count, "signaling" does not.
 */
export function watchWords(text) {
  const out = new Map();
  for (const m of String(text ?? '').matchAll(/[A-Za-z0-9'\u2019]+/g)) {
    const w = frameWord(m[0]);
    if (FRAME_WATCH.includes(w) && !out.has(w)) out.set(w, m[0]);
  }
  return out;
}

/**
 * The tokens in `text` that already sit in FRAME_LIMIT posts of the window, so this post
 * would be the fourth: frames as "Signal Thread", heads, labels and watch words as
 * "Signal". Four counters, same window, same limit. Counted per POST: a token said twice
 * in one post is one post. One word hit by two counters is named once.
 */
export function repeatedFrames(text, windowPosts = []) {
  const counts = { frames: new Map(), heads: new Map(), labels: new Map(), watch: new Map() };
  const setsOf = (t) => ({ ...extractFrames(t), watch: watchWords(t) });
  for (const m of (windowPosts ?? []).slice(-FRAME_WINDOW)) {
    const sets = setsOf(typeof m === 'string' ? m : m?.content);
    for (const set of Object.keys(counts)) {
      for (const key of sets[set].keys()) counts[set].set(key, (counts[set].get(key) ?? 0) + 1);
    }
  }
  const sets = setsOf(text);
  const hit = new Map();
  for (const set of Object.keys(counts)) {
    for (const [key, shown] of sets[set]) {
      if ((counts[set].get(key) ?? 0) >= FRAME_LIMIT && !hit.has(shown.toLowerCase())) {
        hit.set(shown.toLowerCase(), shown);
      }
    }
  }
  return [...hit.values()];
}

/**
 * The gate. Returns { ok: true, text } or { ok: false, reason }.
 * A REPEAT_FRAME rejection also carries `frames`, for the one re-prompt.
 *
 * `recent` is the last chamber messages, for step 8. It defaults to empty so
 * gate(text, promptText) works as §4 documents it; the loop passes the 12 it read.
 * `seeds` and `frameWindow` (DREAMERS-002) default to empty, which switches 5b and 8b off.
 */
export function gate(rawText, promptText = '', recent = [], { seeds = [], frameWindow = [] } = {}) {
  // 1 · think remnants
  const cleaned = cleanThink(rawText);
  if (/<\/?think/i.test(cleaned)) return { ok: false, reason: 'THINK_REMNANT' };
  if (REASONING_OPENERS.some((re) => re.test(cleaned))) return { ok: false, reason: 'THINK_REMNANT' };

  // 2 · prefix strip — never a rejection
  const text = stripPrefix(cleaned);

  // 3 · SKIP, exact. Logged as a skip, not a reject (§4.3).
  if (isSkip(text)) return { ok: false, reason: 'SKIP' };

  // 4 · length
  if (text.length < MIN_CHARS) return { ok: false, reason: 'TOO_SHORT' };
  if (text.length > MAX_CHARS) return { ok: false, reason: 'TOO_LONG' };

  // 4b · truncation — after length, before the prompt leak (DREAMERS-008 commit 2).
  // After length because TOO_SHORT and TOO_LONG are the cheaper, blunter facts about the
  // same string and should be the reason when they apply; before PROMPT_LEAK because an
  // unfinished sentence is a fact about this reply alone, and reporting it does not
  // depend on the prompt being passed in.
  if (!endsComplete(text)) return { ok: false, reason: 'TRUNCATED' };

  // 5 · prompt leak
  if (LEAK_MARKERS.some((m) => text.includes(m))) return { ok: false, reason: 'PROMPT_LEAK' };
  if (leaksPrompt(text, promptText)) return { ok: false, reason: 'PROMPT_LEAK' };

  // 5b · seed leak — a seed is prompt text, in the user half that step 5 does not read.
  if (leaksSeed(text, seeds)) return { ok: false, reason: 'SEED_LEAK' };

  // 6 · register, then money
  if (RE_TOKEN.test(text)) return { ok: false, reason: 'REGISTER_TOKEN' };
  if (RE_PROMISE.test(text)) return { ok: false, reason: 'REGISTER_PROMISE' };
  if (RE_BRAND_ANY.test(text) || RE_BRAND_CASE.test(text)) return { ok: false, reason: 'REGISTER_BRAND' };
  if (RE_MONEY.test(text)) return { ok: false, reason: 'MONEY' };

  // 7 · meta
  if (RE_META.test(text)) return { ok: false, reason: 'META' };

  // 7b · style — after META, before REPEAT (ruled Oct 2; names added Oct 4, DREAMERS-008)
  if (RE_STYLE_WORDS.test(text) || RE_STYLE_PATTERNS.test(text) || RE_STYLE_NAMES.test(text)) {
    return { ok: false, reason: 'STYLE' };
  }

  // 8 · repeat
  const n = normalize(text);
  if ((recent ?? []).some((m) => normalize(typeof m === 'string' ? m : m?.content) === n)) {
    return { ok: false, reason: 'REPEAT' };
  }

  // 8b · repeat frame — last, so every register rule has already spoken and a re-prompt
  // is only ever spent on a post that was otherwise fit to go out.
  const frames = repeatedFrames(text, frameWindow);
  if (frames.length > 0) return { ok: false, reason: 'REPEAT_FRAME', frames };

  return { ok: true, text };
}
