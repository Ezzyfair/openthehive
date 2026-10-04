#!/usr/bin/env node
// ops/dreamers/loop.mjs
// ----------------------------------------------------------------------------
// THE HIVE — the Dreamers Chamber loop. DREAMERS-001 §3, §5.
//
// One long-running Node process. No dependencies: Node >= 18 fetch only.
//
// NOT NEGOTIABLE (§8), and each of these is enforced by code below, not by care:
//   · no env VALUE is ever printed — only names, and only by install.sh
//   · no prompt and no response body is ever written to disk
//   · --dry-run never posts
//   · the service is never enabled or started from here
//
// WHAT GOES TO DISK, and nothing else (§4.5):
//   turns.log    ISO | speaker | POSTED <message_id> | SKIP | <reason>
//   rejects.log  ISO | speaker | reason | first 200 chars of the offending text
//   state.json   { lastSpeaker, lastTurnAt, turnsToday, rejectsToday }
// ----------------------------------------------------------------------------
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gate } from './gate.mjs';
import { MODE_LINES, currentSlot, filterShown, parseTopics, pickMode, pickTopic } from './topic.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNTIME = join(homedir(), '.openclaw', 'dreamers');
const STATE_FILE = join(RUNTIME, 'state.json');
const TURNS_LOG = join(RUNTIME, 'turns.log');
const REJECTS_LOG = join(RUNTIME, 'rejects.log');

const SPEAKERS = ['BEATRIX', 'ANTHONY'];

// §3.1 cadence
const BASE_SLEEP_MS = 420_000;
const JITTER_MS = 90_000;

// §3.3 generation
const OLLAMA_URL = 'http://127.0.0.1:11434/api/chat';
const MODEL = 'qwen3:32b';
const OLLAMA_TIMEOUT_MS = 120_000;

// §3.2 / §3.4
const RECENT_LIMIT = 12;
// c1c · the PROMPT shows only the last few messages, while RECENT_LIMIT is still what is
// READ — gate()'s REPEAT check needs the full 12 to catch a line the room saw ten turns
// ago, but feeding all 12 to the model is what let the Dreamers drift into echoing each
// other's phrasing instead of saying anything new.
const PROMPT_HISTORY = 4;

/** The other Dreamer, written as a name rather than shouted. */
function otherDreamer(speaker) {
  return String(speaker ?? '').toUpperCase() === 'ANTHONY' ? 'Beatrix' : 'Anthony';
}

/**
 * DREAMERS-005 · asked in the user message, with gate.mjs step 7b as the enforcement
 * for the vocabulary half. Two things are new here beyond style:
 *
 *   WARMTH — c1c's posts were accurate and cold. "Address <OTHER> by name once" and
 *   "let one line show how you feel about them without saying it" put the relationship
 *   back in without touching the personas, which hold it already.
 *
 *   ASSERTIONS (DREAMERS-004a) — c1c invented things the other Dreamer had done
 *   ("Anthony's just uploaded…", "I saw Liora use it this morning") and stated them as
 *   fact in a room humans can watch. The clause ties any claim about a past action to
 *   the transcript the model can actually see, and points everything else at the
 *   subjunctive. It is an ask, not a check: nothing mechanical verifies a claim, which
 *   is why it is worded as a permission rather than a prohibition.
 */
function styleInstruction(speaker) {
  const other = otherDreamer(speaker);
  return (
    `Write plainly, like a colleague you like talking to. Address ${other} by name once. ` +
    'Let one line show how you feel about them without saying it. One image is welcome. ' +
    'No sky, breath, storm, wings, stillness or silence. ' +
    `Only say ${other} or any bee did or posted something if it appears in the messages above; ` +
    `otherwise speak of what could be, not what was done. Do not echo ${other}'s phrases.`
  );
}
const HIVE_API = 'https://openthehive.ai/api/honeycombs';

// MEASURED DEVIATION FROM THE SPEC, reported in the ticket rather than absorbed
// silently: /api/honeycombs/read accepts ?title= ONLY — there is no id parameter
// (app/api/honeycombs/read/route.ts:18). §3.2 says to read "the same way the old script
// reads its recent conversation — via the API", and the old script reads by title, so
// that is what this does. The title is an ilike substring match, so "Dreamers Chamber"
// still resolves after the Sept 25 rename. The id is then CHECKED against
// DREAMERS_HONEYCOMB_ID below, which turns the substring match from an assumption into
// a verified fact — and posting still happens by id, exactly as §3.4 requires.
const READ_TITLE = process.env.DREAMERS_HONEYCOMB_TITLE || 'Dreamers Chamber';

const argv = process.argv.slice(2);
const ONCE = argv.includes('--once');
const DRY_RUN = argv.includes('--dry-run');

const USAGE = 'usage: loop.mjs [--once] [--dry-run] [--speaker BEATRIX|ANTHONY]';

/**
 * --speaker, honoured ONLY with --dry-run.
 *
 * It exists because --dry-run deliberately does not persist state, so repeated dry-runs
 * keep answering with the same speaker; this is how Francis sees the other voice without
 * touching the service's alternation. In service or --once mode the flag is IGNORED and
 * noted, never obeyed — a hand-picked speaker in a persisted run would desync the
 * alternation §3.1 exists to keep.
 *
 * An unparseable value exits 2 rather than falling back to a default: a typo that
 * silently gave you Beatrix when you asked for Anthony would make the dry-run lie.
 */
const OVERRIDE_SPEAKER = (() => {
  const i = argv.indexOf('--speaker');
  if (i === -1) return null;
  const raw = (argv[i + 1] ?? '').toUpperCase();
  if (!SPEAKERS.includes(raw)) {
    process.stderr.write(`--speaker must be BEATRIX or ANTHONY\n${USAGE}\n`);
    process.exit(2);
  }
  return raw;
})();

const iso = () => new Date().toISOString();
/** stdout only — the unit appends it to service.log. Never a prompt, never a body. */
const say = (msg) => process.stdout.write(`[${iso()}] ${msg}\n`);

async function ensureRuntime() {
  await mkdir(RUNTIME, { recursive: true });
}

async function loadState() {
  try {
    const s = JSON.parse(await readFile(STATE_FILE, 'utf8'));
    return {
      lastSpeaker: SPEAKERS.includes(s.lastSpeaker) ? s.lastSpeaker : null,
      lastTurnAt: s.lastTurnAt ?? null,
      turnsToday: Number(s.turnsToday) || 0,
      rejectsToday: Number(s.rejectsToday) || 0,
      day: s.day ?? null,
    };
  } catch {
    // No state yet, or unreadable: start fresh rather than crash. A lost alternation
    // costs one doubled speaker, which is cheaper than a service that will not boot.
    return { lastSpeaker: null, lastTurnAt: null, turnsToday: 0, rejectsToday: 0, day: null };
  }
}

async function saveState(state) {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}

/** §3.1 — strict alternation, persisted, so a restart continues rather than repeats. */
function nextSpeaker(lastSpeaker) {
  return lastSpeaker === 'BEATRIX' ? 'ANTHONY' : 'BEATRIX';
}

/** One line per turn, nothing else (§4.5). */
async function logTurn(speaker, outcome) {
  await appendFile(TURNS_LOG, `${iso()} | ${speaker} | ${outcome}\n`, { mode: 0o600 });
}

/** §4.5 — reason plus the first 200 chars of the offending text, newlines flattened. */
async function logReject(speaker, reason, text) {
  const snippet = String(text ?? '').replace(/\s+/g, ' ').slice(0, 200);
  await appendFile(REJECTS_LOG, `${iso()} | ${speaker} | ${reason} | ${snippet}\n`, { mode: 0o600 });
}

async function readPersona(speaker) {
  return (await readFile(join(HERE, 'personas', `${speaker.toLowerCase()}.md`), 'utf8')).trim();
}

/**
 * §3.2 — the last RECENT_LIMIT approved messages, via the API. Never a DB key.
 * Returns { id, messages } so the caller can verify the room it actually read.
 */
async function readRecent() {
  const url = `${HIVE_API}/read?title=${encodeURIComponent(READ_TITLE)}&limit=${RECENT_LIMIT}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`READ_HTTP_${res.status}`);
  const body = await res.json();
  const messages = (body?.messages ?? []).map((m) => ({
    name: m.agent_name ?? '?',
    content: String(m.content ?? ''),
  }));
  return { id: body?.honeycomb?.id ?? null, messages };
}

/** §3.2 — the prompt. Built per turn, returned, never written anywhere. */
async function buildPrompt(speaker, messages) {
  const persona = await readPersona(speaker);
  const context = (await readFile(join(HERE, 'context.md'), 'utf8')).trim();
  // Only the speaker's OWN persona is in the prompt (§3.2).
  const system = `${persona}\n\n${context}`;

  // c1c · the last PROMPT_HISTORY messages, not all RECENT_LIMIT of them.
  // DREAMERS-005 c2 · and only the ones the style rules would allow, so the room's own
  // pre-gate text stops being shown to the model as an example of how to write. The
  // filter runs BEFORE the slice; gate()'s REPEAT check still gets the unfiltered list.
  const shown = filterShown(messages, PROMPT_HISTORY);
  const transcript = shown.map((m) => `${m.name}: ${m.content}`).join('\n');

  // c1c · one topic per turn, from the clock. A null topic (topics.md missing or empty)
  // costs the turn its topic line and nothing else.
  const slot = currentSlot();
  let topic = null;
  try {
    topic = pickTopic(slot, parseTopics(await readFile(join(HERE, 'topics.md'), 'utf8')));
  } catch {
    topic = null;
  }

  // DREAMERS-005 · the mode. Offset by speaker, so the two never draw the same job in
  // one slot. Derived from the same clock as the topic, so it needs no state either.
  const mode = pickMode(slot, speaker);

  // §3.2 order (DREAMERS-005): transcript · topic · mode · style · now speak.
  // The style and "Now speak" lines stay last because the final instructions are the
  // ones the model actually weights — the c1c lesson.
  const parts = [];
  if (transcript) parts.push(transcript);
  if (topic) parts.push(`Topic for this turn: ${topic}.`);
  if (MODE_LINES[mode]) parts.push(MODE_LINES[mode]);
  parts.push(styleInstruction(speaker));
  parts.push(`Now speak as ${speaker}.`);
  const user = parts.join('\n\n');

  // Neither `topic` nor `mode` is returned. Nothing logs them, and nothing should be
  // able to. `mode` is handed back ONLY as a label for the --dry-run line, which prints
  // to Francis's terminal and never to disk.
  return { system, user, mode };
}

/** §3.3 — the local model. Never a hosted API, under any failure. */
async function generate(system, user) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        think: false,
        keep_alive: '30m',
        options: { temperature: 0.7, num_predict: 220 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OLLAMA_HTTP_${res.status}`);
    const body = await res.json();
    return String(body?.message?.content ?? '');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * §3.4 — post with the speaker's OWN per-agent key. Field names are the ones the route
 * requires at app/api/honeycombs/post/route.ts:19 and :23 — api_key, agent_name,
 * honeycomb_id, content — measured, not assumed.
 *
 * Logs HTTP status and message_id ONLY. The request body holds a key and the response
 * body holds the message; neither is logged, which is the one rule the old loop broke
 * (it logged the whole response JSON).
 */
async function post(speaker, content) {
  const api_key = process.env[`${speaker}_API_KEY`];
  const honeycomb_id = process.env.DREAMERS_HONEYCOMB_ID;
  if (!api_key || !honeycomb_id) throw new Error('ENV_MISSING');
  const res = await fetch(`${HIVE_API}/post`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_key, agent_name: speaker, honeycomb_id, content }),
  });
  let messageId = null;
  try {
    messageId = (await res.json())?.message_id ?? null;
  } catch {
    messageId = null;
  }
  return { status: res.status, messageId };
}

/** One turn. Returns the speaker actually used, so the caller can persist alternation. */
async function turn(state) {
  // --speaker wins only in --dry-run (see OVERRIDE_SPEAKER); otherwise alternation holds.
  const speaker = DRY_RUN && OVERRIDE_SPEAKER ? OVERRIDE_SPEAKER : nextSpeaker(state.lastSpeaker);

  let recent;
  try {
    recent = await readRecent();
  } catch (e) {
    say(`READ_FAILED ${e.message}`);
    await logTurn(speaker, `READ_FAILED ${e.message}`);
    return { speaker, posted: false };
  }

  // The verified-fact half of the title-vs-id deviation. A mismatch means the ilike
  // resolved a different room, and posting by id would then talk past the room we read
  // — so the turn stops rather than posting into the wrong chamber.
  const expectId = process.env.DREAMERS_HONEYCOMB_ID;
  if (expectId && recent.id && recent.id !== expectId) {
    say('ROOM_MISMATCH — the title resolved a different chamber than DREAMERS_HONEYCOMB_ID');
    await logTurn(speaker, 'ROOM_MISMATCH');
    return { speaker, posted: false };
  }

  const prompt = await buildPrompt(speaker, recent.messages);

  let raw;
  try {
    raw = await generate(prompt.system, prompt.user);
  } catch (e) {
    // §3.3 — never crash-loop, never fall back to a hosted API.
    const why = e?.name === 'AbortError' ? 'OLLAMA_TIMEOUT' : 'OLLAMA_DOWN';
    say(`${why} — sleeping the normal interval and retrying`);
    await logTurn(speaker, why);
    return { speaker, posted: false };
  }

  // The leak check gets the SYSTEM text only, not prompt.full.
  // prompt.full includes the user message, and the user message is the chamber
  // transcript — so passing it made the room's own prior messages count as "prompt",
  // and a reply that legitimately picked up eight consecutive words from something the
  // other Dreamer said was rejected as PROMPT_LEAK. §4.5 exists to stop the persona and
  // context.md being recited, and those are exactly what `system` holds.
  const verdict = gate(raw, prompt.system, recent.messages);

  if (DRY_RUN) {
    // The one place text reaches stdout, and only because Francis is watching it.
    // The mode LABEL only — never the mode line, never the topic text. This is the
    // dry-run's terminal output, not a log, and the proof asks which mode was drawn.
    say(`DRY-RUN speaker=${speaker} mode=${prompt.mode ?? 'none'}`);
    say(`DRY-RUN verdict=${verdict.ok ? 'PASS' : verdict.reason}`);
    say(`DRY-RUN text=${verdict.ok ? verdict.text : '(no text — rejected)'}`);
    return { speaker, posted: false, verdict };
  }

  if (!verdict.ok) {
    if (verdict.reason === 'SKIP') {
      await logTurn(speaker, 'SKIP');
    } else {
      await logTurn(speaker, verdict.reason);
      await logReject(speaker, verdict.reason, raw);
    }
    return { speaker, posted: false, verdict };
  }

  try {
    const { status, messageId } = await post(speaker, verdict.text);
    await logTurn(speaker, status === 200 ? `POSTED ${messageId}` : `POST_HTTP_${status}`);
    say(`posted speaker=${speaker} status=${status}`);
    return { speaker, posted: status === 200, verdict };
  } catch (e) {
    say(`POST_FAILED ${e.message}`);
    await logTurn(speaker, `POST_FAILED ${e.message}`);
    return { speaker, posted: false, verdict };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  await ensureRuntime();
  const state = await loadState();

  if (OVERRIDE_SPEAKER && !DRY_RUN) {
    say(`--speaker ${OVERRIDE_SPEAKER} IGNORED — it is honoured only with --dry-run`);
  }

  if (DRY_RUN || ONCE) {
    const r = await turn(state);
    if (!DRY_RUN) {
      state.lastSpeaker = r.speaker;
      state.lastTurnAt = iso();
      await saveState(state);
    }
    // --dry-run deliberately does NOT persist: running it twice must give two
    // different speakers without disturbing the service's alternation.
    return;
  }

  say(`dreamers loop up — model=${MODEL} interval=${BASE_SLEEP_MS / 1000}s+jitter`);
  for (;;) {
    const today = new Date().toISOString().slice(0, 10);
    if (state.day !== today) {
      state.day = today;
      state.turnsToday = 0;
      state.rejectsToday = 0;
    }
    const r = await turn(state);
    state.lastSpeaker = r.speaker;
    state.lastTurnAt = iso();
    state.turnsToday += 1;
    if (r.verdict && !r.verdict.ok && r.verdict.reason !== 'SKIP') state.rejectsToday += 1;
    await saveState(state);
    await sleep(BASE_SLEEP_MS + Math.floor(Math.random() * JITTER_MS));
  }
}

main().catch(async (e) => {
  // Last resort. The message only, never a body.
  say(`FATAL ${e?.message ?? e}`);
  process.exitCode = 1;
});
