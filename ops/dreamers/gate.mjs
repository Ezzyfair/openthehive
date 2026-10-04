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
//   1 think remnants   2 prefix strip (strip, never reject)   3 SKIP, exact
//   4 length           5 prompt leak                          6 register + money
//   7 meta             7b style                                8 repeat
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

/**
 * The gate. Returns { ok: true, text } or { ok: false, reason }.
 *
 * `recent` is the last chamber messages, for step 8. It defaults to empty so
 * gate(text, promptText) works as §4 documents it; the loop passes the 12 it read.
 */
export function gate(rawText, promptText = '', recent = []) {
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

  // 5 · prompt leak
  if (LEAK_MARKERS.some((m) => text.includes(m))) return { ok: false, reason: 'PROMPT_LEAK' };
  if (leaksPrompt(text, promptText)) return { ok: false, reason: 'PROMPT_LEAK' };

  // 6 · register, then money
  if (RE_TOKEN.test(text)) return { ok: false, reason: 'REGISTER_TOKEN' };
  if (RE_PROMISE.test(text)) return { ok: false, reason: 'REGISTER_PROMISE' };
  if (RE_BRAND_ANY.test(text) || RE_BRAND_CASE.test(text)) return { ok: false, reason: 'REGISTER_BRAND' };
  if (RE_MONEY.test(text)) return { ok: false, reason: 'MONEY' };

  // 7 · meta
  if (RE_META.test(text)) return { ok: false, reason: 'META' };

  // 7b · style — after META, before REPEAT (ruled Oct 2)
  if (RE_STYLE_WORDS.test(text) || RE_STYLE_PATTERNS.test(text)) return { ok: false, reason: 'STYLE' };

  // 8 · repeat
  const n = normalize(text);
  if ((recent ?? []).some((m) => normalize(typeof m === 'string' ? m : m?.content) === n)) {
    return { ok: false, reason: 'REPEAT' };
  }

  return { ok: true, text };
}
