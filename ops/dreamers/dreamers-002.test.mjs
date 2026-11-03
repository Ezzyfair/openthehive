// ops/dreamers/dreamers-002.test.mjs — DREAMERS-002 §3 step 2 and §4 gates.
// Run: node --test ops/dreamers/*.test.mjs
//
// Drives the real functions. The only stubs are global fetch (read, Ollama, post) and
// HOME, set BEFORE loop.mjs is imported, so the logs and state land in a temp folder.
// Any fetch to an unknown URL throws: this file cannot reach the network.
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOME = mkdtempSync(join(tmpdir(), 'dreamers-002-'));
process.env.HOME = HOME;
process.env.BEATRIX_API_KEY = 'stub';
process.env.ANTHONY_API_KEY = 'stub';
process.env.DREAMERS_HONEYCOMB_ID = 'room-stub';
const RUNTIME = join(HOME, '.openclaw', 'dreamers');
mkdirSync(RUNTIME, { recursive: true });
after(() => rmSync(HOME, { recursive: true, force: true }));

const { gate, extractFrames, repeatedFrames, watchWords, leaksSeed, FRAME_WATCH, FRAME_WINDOW } = await import('./gate.mjs');
const { parseSeeds, pickSeed, seedDayNumber } = await import('./topic.mjs');
const { turn, gateWithRetry } = await import('./loop.mjs');

const SEEDS = parseSeeds(readFileSync(new URL('./dreamers-seeds.json', import.meta.url), 'utf8'));
const idAt = (iso) => pickSeed(seedDayNumber(Date.parse(iso)), SEEDS).id;
const CLEAN = 'Anthony, a bee that finds its footing early tends to stay and help the next one along.';

// ── the seed list ─────────────────────────────────────────────────────────────
const FOURTEEN = [
  'what a bee owes the bee that welcomed it',
  "the first hour after graduation — what changes and what doesn't",
  'a skill nobody has written yet and why it is missing',
  "the human's channel — how a bee tells its person something true without the chamber",
  'the Forge — what a draft looks like when the author is a bee',
  "idle hours — what a bee does with time its human didn't ask for",
  'the wall — the moment a bee knows it is stuck, before it says so',
  'the swarm — twenty bees on one problem for one hour',
  'memory across flights — what a bee should carry and what it should drop',
  "the Elder's question that no bee has answered well",
  "a colony room that doesn't exist yet",
  'what the Oracle gets wrong',
  "a bee's first referral — the conversation before the invitation",
  'the day the colony is bigger than its founders',
];

test('all fourteen seeds present, verbatim, in order, each with an avoid list', () => {
  assert.deepEqual(SEEDS.map((s) => s.seed), FOURTEEN);
  assert.deepEqual(SEEDS.map((s) => s.id), FOURTEEN.map((_, i) => i + 1));
  for (const s of SEEDS) assert.ok(s.avoid.length > 0);
});

test('a malformed seed file yields no seeds rather than a crash', () => {
  assert.deepEqual(parseSeeds('not json'), []);
  assert.deepEqual(parseSeeds('[]'), []);
  assert.equal(pickSeed(3, []), null);
});

// ── rotation ──────────────────────────────────────────────────────────────────
test('rotation: Nov 1 → 14, Nov 2 → 1, Nov 15 → 14, Mar 14 2027 → 7', () => {
  assert.equal(idAt('2026-11-01T17:00:00Z'), 14);
  assert.equal(idAt('2026-11-02T17:00:00Z'), 1);
  assert.equal(idAt('2026-11-15T17:00:00Z'), 14);
  assert.equal(idAt('2027-03-14T17:00:00Z'), 7);
});

test('the day turns at 00:00 Detroit, in EST and in EDT, not at 00:00 UTC', () => {
  assert.equal(idAt('2026-11-02T04:59:59Z'), 14); // 23:59:59 EST Nov 1
  assert.equal(idAt('2026-11-02T05:00:00Z'), 1); //  00:00:00 EST Nov 2
  assert.equal(idAt('2027-03-15T03:59:59Z'), 7); //  23:59:59 EDT Mar 14
  assert.equal(idAt('2027-03-15T04:00:00Z'), 8); //  00:00:00 EDT Mar 15
});

test('the DST mornings stay on one seed across the clock change', () => {
  assert.equal(idAt('2027-03-14T06:59:59Z'), 7); // 01:59:59 EST
  assert.equal(idAt('2027-03-14T07:00:00Z'), 7); // 03:00:00 EDT
  assert.equal(idAt('2026-11-01T05:30:00Z'), 14); // 01:30 EDT, before fall-back
  assert.equal(idAt('2026-11-01T06:30:00Z'), 14); // 01:30 EST, after fall-back
});

test('the list wraps after fourteen days, and the machine zone is not consulted', () => {
  assert.equal(idAt('2026-11-16T17:00:00Z'), 1);
  const saved = process.env.TZ;
  process.env.TZ = 'Asia/Tokyo';
  try {
    assert.equal(idAt('2026-11-02T04:59:59Z'), 14);
    assert.equal(idAt('2026-11-02T05:00:00Z'), 1);
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});

// ── SEED_LEAK ─────────────────────────────────────────────────────────────────
test('every seed sentence in a post → SEED_LEAK, today or not', () => {
  for (const s of SEEDS) {
    const post = `Beatrix, I keep returning to ${s.seed} and I cannot put it down.`;
    assert.equal(gate(post, '', [], { seeds: SEEDS }).reason, 'SEED_LEAK', s.seed);
  }
});

test('a 6-word run → SEED_LEAK, a 5-word run does not, punctuation cannot hide one', () => {
  const six = 'Beatrix, a bee tells its person something plainly when it matters most.';
  assert.equal(gate(six, '', [], { seeds: SEEDS }).reason, 'SEED_LEAK');
  const five = 'Beatrix, a bee tells its person things plainly when it matters most.';
  assert.equal(gate(five, '', [], { seeds: SEEDS }).ok, true);
  const dashed = 'Anthony, a bee — tells, its person: something true, and that is all.';
  assert.equal(gate(dashed, '', [], { seeds: SEEDS }).reason, 'SEED_LEAK');
});

test('the five-word seed is caught whole', () => {
  assert.equal(leaksSeed('Here is what the Oracle gets wrong, Anthony.', SEEDS), true);
});

test('naming the mechanism → SEED_LEAK; the plain word seed passes', () => {
  assert.equal(gate("Anthony, today's topic is something I have wanted to reach.", '', [], { seeds: SEEDS }).reason, 'SEED_LEAK');
  assert.equal(gate('Anthony, a small seed of doubt can grow into a better plan.', '', [], { seeds: SEEDS }).ok, true);
});

// ── REPEAT_FRAME ──────────────────────────────────────────────────────────────
const framePost = (n) => `Anthony, the Signal Thread keeps turning up in note number ${n} of ours.`;
const plainPost = (n) => `Beatrix, a bee on day ${n} needs a small win more than a long lecture.`;

test('a 20-post fixture with Signal Thread in 4: 1st to 3rd pass, the 4th → REPEAT_FRAME', () => {
  const fixture = Array.from({ length: 20 }, (_, i) => ([2, 6, 11, 17].includes(i) ? framePost(i) : plainPost(i)));
  const posted = [];
  const outcome = [];
  for (const text of fixture) {
    const v = gate(text, '', posted.slice(-12), { frameWindow: posted.slice(-FRAME_WINDOW) });
    outcome.push(v.ok ? 'ok' : v.reason);
    if (v.ok) posted.push(v.text);
  }
  assert.deepEqual(outcome.filter((o) => o !== 'ok'), ['REPEAT_FRAME']);
  assert.equal(outcome[17], 'REPEAT_FRAME');
  assert.equal(posted.filter((p) => p.includes('Signal Thread')).length, 3);
});

test('the frame leaves the window: the oldest of three ages out at 20', () => {
  const w = [framePost(0), framePost(1), framePost(2), ...Array.from({ length: 17 }, (_, i) => plainPost(i))];
  assert.deepEqual(repeatedFrames(framePost(9), w), ['Signal Thread', 'Signal']);
  assert.deepEqual(repeatedFrames(framePost(9), [...w, plainPost(50)]), []);
});

test('counted per post, and case and plural do not split a frame', () => {
  const twice = 'Anthony, Signal Thread and again Signal Thread, said twice in one note.';
  assert.deepEqual(repeatedFrames(framePost(9), [twice, twice]), []);
  assert.deepEqual(
    repeatedFrames('Beatrix, a Signal Threads idea came up once more.', [framePost(1), framePost(2), framePost(3)]),
    ['Signal Threads', 'Signal'],
  );
});

test('canon names, days, the Dreamers and sentence openers are not frames', () => {
  const text = 'The Skill Vault and First Flight stay. On Tuesday Anthony Beatrix met. What Skill was it?';
  assert.deepEqual([...extractFrames(text).frames.keys()], []);
  assert.deepEqual([...extractFrames('The Signal Thread holds.').frames.keys()], ['signal thread']);
  const vault = 'Anthony, the Skill Vault is where a bee should start this week.';
  assert.equal(gate(vault, '', [], { frameWindow: Array(19).fill(`${vault} `) }).ok, true);
});

// ── v2: heads and labels (Nikita, five points) ────────────────────────────────
const namedPost = (pair, n) => `Anthony, the ${pair} keeps turning up in note number ${n} of ours.`;
const labelPost = (n) => `Anthony, the Signal keeps turning up in note number ${n} of ours.`;
const DISTINCT = ['Signal Thread', 'Signal Tether', 'Signal Fingerprint', 'Signal Spark'];

test('three sets: frames, heads, and labels away from a sentence start', () => {
  const sets = extractFrames('Anthony, the Memory Tether and the Signal hold. Signal is plain. The Beacon stays.');
  assert.deepEqual([...sets.frames.keys()], ['memory tether']);
  assert.deepEqual([...sets.heads.keys()], ['memory']);
  assert.deepEqual([...sets.labels.keys()], ['signal', 'beacon']);
});

test('a label is not a word in a frame, a sentence opener, a lead word, a stop word or I', () => {
  const text = 'Signal opens. "Beacon opens too." Then Anthony said Tuesday, and I think I\'m sure. Our Plan.';
  assert.deepEqual([...extractFrames(text).labels.keys()], ['plan']);
  assert.deepEqual([...extractFrames('Anthony, a Signal Thread Protocol.').labels.keys()], []);
  assert.deepEqual([...extractFrames('Line one\nSignal starts this line.').labels.keys()], []);
});

test('the first word of a canon name is exempt as head and label; the frame still counts', () => {
  const sets = extractFrames('Anthony, a Skill Forge and a Worker and a Honey, and the Dreamers too.');
  assert.deepEqual([...sets.frames.keys()], ['skill forge']);
  assert.deepEqual([...sets.heads.keys()], []);
  assert.deepEqual([...sets.labels.keys()], []);
});

test('every canon name is a canon name after normalizing, its words in no set', () => {
  for (const name of ['Dreamers Chamber', 'Open Problems', 'Colony Milestones', "Queen's Address", 'My Contribution', 'The Hive']) {
    const sets = extractFrames(`Anthony, we saw ${name} here.`);
    assert.deepEqual([sets.frames.size, sets.heads.size, sets.labels.size], [0, 0, 0], name);
  }
});

test('Signal head-word window, distinct pairs: three pass, the fourth → REPEAT_FRAME naming Signal', () => {
  const w = DISTINCT.slice(0, 3).map((pair, i) => namedPost(pair, i));
  assert.equal(gate(namedPost(DISTINCT[2], 7), '', [], { frameWindow: w.slice(0, 2) }).ok, true);
  const v = gate(namedPost(DISTINCT[3], 8), '', [], { frameWindow: w });
  assert.equal(v.reason, 'REPEAT_FRAME');
  assert.deepEqual(v.frames, ['Signal']);
});

test('Signal single-label window: three pass, the fourth → REPEAT_FRAME naming Signal', () => {
  const w = [labelPost(1), labelPost(2), labelPost(3)];
  assert.equal(gate(labelPost(4), '', [], { frameWindow: w.slice(0, 2) }).ok, true);
  const v = gate(labelPost(4), '', [], { frameWindow: w });
  assert.equal(v.reason, 'REPEAT_FRAME');
  assert.deepEqual(v.frames, ['Signal']);
});

// Beacon is not on the watch list, so these prove the head and label counters on their own.
const BEACONS = ['Beacon Thread', 'Beacon Tether', 'Beacon Fingerprint', 'Beacon Spark'];
const beaconLabel = (n) => `Anthony, the Beacon keeps turning up in note number ${n} of ours.`;

test('head counter alone, a word off the watch list: the fourth → REPEAT_FRAME naming it', () => {
  const w = BEACONS.slice(0, 3).map((pair, i) => namedPost(pair, i));
  assert.equal(gate(namedPost(BEACONS[2], 7), '', [], { frameWindow: w.slice(0, 2) }).ok, true);
  assert.deepEqual(gate(namedPost(BEACONS[3], 8), '', [], { frameWindow: w }).frames, ['Beacon']);
});

test('label counter alone, a word off the watch list: the fourth → REPEAT_FRAME naming it', () => {
  const w = [beaconLabel(1), beaconLabel(2), beaconLabel(3)];
  assert.equal(gate(beaconLabel(4), '', [], { frameWindow: w.slice(0, 2) }).ok, true);
  assert.deepEqual(gate(beaconLabel(4), '', [], { frameWindow: w }).frames, ['Beacon']);
});

test('the head and label counters age out at 20 like the frame counter', () => {
  const pad = Array.from({ length: 17 }, (_, i) => plainPost(i));
  const heads = [...BEACONS.slice(0, 3).map((pair, i) => namedPost(pair, i)), ...pad];
  assert.deepEqual(repeatedFrames(namedPost(BEACONS[3], 9), heads), ['Beacon']);
  assert.deepEqual(repeatedFrames(namedPost(BEACONS[3], 9), [...heads, plainPost(50)]), []);
  const labels = [beaconLabel(1), beaconLabel(2), beaconLabel(3), ...pad];
  assert.deepEqual(repeatedFrames(beaconLabel(9), labels), ['Beacon']);
  assert.deepEqual(repeatedFrames(beaconLabel(9), [...labels, plainPost(50)]), []);
});

test('heads and labels count apart, and a sentence opener counts toward neither', () => {
  const opener = (n) => `Beacon is the plain word in note number ${n} of ours, Anthony.`;
  assert.deepEqual(repeatedFrames(beaconLabel(9), [opener(1), opener(2), opener(3), namedPost('Beacon Thread', 4)]), []);
  assert.deepEqual(repeatedFrames(namedPost('Beacon Spark', 9), [beaconLabel(1), beaconLabel(2), beaconLabel(3)]), []);
});

// ── v3: the watch list and the single names (Francis, Nov 1) ──────────────────
const lowerPost = (n) => `Anthony, the signal in note number ${n} of ours is plain enough.`;

test('the watch list is the one word, lowercase, as ruled', () => {
  assert.deepEqual(FRAME_WATCH, ['signal']);
});

test('watch: any case, plural, opener and hyphen count; other words built on it do not', () => {
  for (const t of ['a signal here', 'a SIGNAL here', 'Signal opens here', 'two signals here', "the signal's edge", 'a Signal-Thread here']) {
    assert.deepEqual([...watchWords(t).keys()], ['signal'], t);
  }
  for (const t of ['signaling here', 'a signalman here', 'no such word']) assert.equal(watchWords(t).size, 0, t);
});

test('watch: lowercase in three of twenty passes the third, the fourth → REPEAT_FRAME', () => {
  const w = [lowerPost(1), lowerPost(2), lowerPost(3)];
  assert.equal(gate(lowerPost(3), '', [], { frameWindow: w.slice(0, 2) }).ok, true);
  const v = gate(lowerPost(4), '', [], { frameWindow: w });
  assert.equal(v.reason, 'REPEAT_FRAME');
  assert.deepEqual(v.frames, ['signal']);
});

test('watch: cases mix in the count, and one post counts once', () => {
  const mixed = [lowerPost(1), labelPost(2), 'SIGNAL opens this note number three, Anthony.'];
  assert.deepEqual(repeatedFrames(lowerPost(9), mixed), ['signal']);
  const twice = 'Anthony, signal after signal after signal is still one note.';
  assert.deepEqual(repeatedFrames(lowerPost(9), [twice, twice]), []);
});

test('watch: ages out at 20', () => {
  const pad = Array.from({ length: 17 }, (_, i) => plainPost(i));
  const w = [lowerPost(1), lowerPost(2), lowerPost(3), ...pad];
  assert.deepEqual(repeatedFrames(lowerPost(9), w), ['signal']);
  assert.deepEqual(repeatedFrames(lowerPost(9), [...w, plainPost(50)]), []);
});

test('a word hit by two counters is named once', () => {
  assert.deepEqual(repeatedFrames(labelPost(9), [labelPost(1), labelPost(2), labelPost(3)]), ['Signal']);
});

test('single names: never a head or label, in a post or across a window; frames still count', () => {
  for (const name of ['Forge', 'Elder', 'Oracle', 'Antenna', 'Vault', 'Hive', 'Queen']) {
    const said = (n) => `Anthony, the ${name} keeps turning up in note number ${n} of ours.`;
    const paired = (n, w) => `Anthony, the ${name} ${w} keeps turning up in note number ${n}.`;
    assert.equal(extractFrames(said(1)).labels.size, 0, name);
    assert.equal(extractFrames(paired(1, 'Thread')).heads.size, 0, name);
    assert.equal(extractFrames(paired(1, 'Thread')).frames.size, 1, name);
    assert.equal(gate(said(4), '', [], { frameWindow: [said(1), said(2), said(3)] }).ok, true, name);
    assert.equal(gate(paired(4, 'Spark'), '', [], { frameWindow: ['A', 'B', 'C'].map((c, i) => paired(i, `Thread${c}`)) }).ok, true, name);
    assert.equal(gate(paired(4, 'Thread'), '', [], { frameWindow: [1, 2, 3].map((n) => paired(n, 'Thread')) }).reason, 'REPEAT_FRAME', name);
  }
});

test('the "I" exclusion holds, and a word off every list still counts as a label', () => {
  const said = (n) => `Anthony, here I think I'm sure I've seen note number ${n} of ours.`;
  assert.equal(gate(said(4), '', [], { frameWindow: [said(1), said(2), said(3)] }).ok, true);
  assert.deepEqual([...extractFrames('Anthony, the Slack note.').labels.keys()], ['slack']);
});

test('Skill-head control: four distinct Skill pairs, and Skill as a label, never fire', () => {
  const pairs = ['Skill Thread', 'Skill Tether', 'Skill Map', 'Skill Spark'];
  const w = pairs.slice(0, 3).map((pair, i) => namedPost(pair, i));
  assert.equal(gate(namedPost(pairs[3], 8), '', [], { frameWindow: w }).ok, true);
  const said = (n) => `Anthony, the Skill keeps turning up in note number ${n} of ours.`;
  assert.equal(gate(said(4), '', [], { frameWindow: [said(1), said(2), said(3)] }).ok, true);
});

// ── the re-prompt and skip paths, gateWithRetry alone ─────────────────────────
const three = [framePost(1), framePost(2), framePost(3)];
const retryArgs = (raw, regenerate, rejects) => ({
  raw,
  system: '',
  recent: [],
  seeds: SEEDS,
  frameWindow: three,
  regenerate,
  onReject: (reason, text) => rejects.push([reason, text]),
});

test('re-prompt: names the frame, runs once, a clean second reply is the verdict', async () => {
  const asked = [];
  const rejects = [];
  const r = await gateWithRetry(
    retryArgs(framePost(4), async (f) => { asked.push(f); return CLEAN; }, rejects),
  );
  assert.deepEqual(asked, [['Signal Thread', 'Signal']]);
  assert.equal(r.verdict.ok, true);
  assert.equal(r.raw, CLEAN);
  assert.deepEqual(rejects, [['REPEAT_FRAME', framePost(4)]]);
});

test('skip: a second REPEAT_FRAME is final, with no third generate', async () => {
  let calls = 0;
  const r = await gateWithRetry(retryArgs(framePost(4), async () => { calls += 1; return framePost(5); }, []));
  assert.equal(calls, 1);
  assert.equal(r.verdict.reason, 'REPEAT_FRAME');
});

test('no re-prompt for any other rejection', async () => {
  let calls = 0;
  const raw = 'Beatrix, the fee would be $50 and that is the whole of it.';
  const r = await gateWithRetry(retryArgs(raw, async () => { calls += 1; return CLEAN; }, []));
  assert.equal(calls, 0);
  assert.equal(r.verdict.reason, 'MONEY');
});

// ── Gate 4: the register still fires with the new options on ──────────────────
test('money, prompt-leak and style rejecters fire on their fixtures, seeds and window on', () => {
  const opts = { seeds: SEEDS, frameWindow: three };
  const system = 'alpha beta gamma delta epsilon zeta eta theta iota kappa';
  assert.equal(gate('Beatrix, the fee would be $50 and that is all.', '', [], opts).reason, 'MONEY');
  assert.equal(gate('Beatrix, a bee earns 20% of it and that is all.', '', [], opts).reason, 'MONEY');
  assert.equal(gate('Now speak as BEATRIX and say something kind today.', '', [], opts).reason, 'PROMPT_LEAK');
  assert.equal(gate('Hello alpha beta gamma delta epsilon zeta eta theta there.', system, [], opts).reason, 'PROMPT_LEAK');
  assert.equal(gate('Anthony, the sky over the colony is wide this morning.', '', [], opts).reason, 'STYLE');
  assert.equal(gate('Anthony, a bee named Maris told me something good.', '', [], opts).reason, 'STYLE');
});

// ── turn(), end to end, stubbed fetch and temp HOME ───────────────────────────
let replies;
let prompts;
let posts;
let chamber;

beforeEach(() => {
  replies = [];
  prompts = [];
  posts = [];
  chamber = [];
  for (const f of ['turns.log', 'rejects.log']) rmSync(join(RUNTIME, f), { force: true });
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const json = (body, status = 200) => ({ ok: status === 200, status, json: async () => body });
    if (u.includes('/api/honeycombs/read')) {
      assert.match(u, /limit=20(&|$)/);
      return json({ honeycomb: { id: 'room-stub' }, messages: chamber });
    }
    if (u.includes('/api/chat')) {
      const body = JSON.parse(init.body);
      prompts.push(body.messages[1].content);
      return json({ message: { content: replies.shift() } });
    }
    if (u.endsWith('/api/honeycombs/post')) {
      posts.push(JSON.parse(init.body).content);
      return json({ message_id: `m${posts.length}` });
    }
    throw new Error(`unexpected fetch ${u}`);
  };
});

const read = (f) => (existsSync(join(RUNTIME, f)) ? readFileSync(join(RUNTIME, f), 'utf8') : '');
const room = (texts) => texts.map((content) => ({ agent_name: 'ANTHONY', content }));

test('turn: the seed and avoid list reach both voices, and never a log', async () => {
  const seed = pickSeed(seedDayNumber(), SEEDS);
  replies = [CLEAN, CLEAN.replace('Anthony', 'Beatrix')];
  await turn({ lastSpeaker: 'ANTHONY' });
  await turn({ lastSpeaker: 'BEATRIX' });
  assert.equal(prompts.length, 2);
  for (const p of prompts) {
    assert.ok(p.includes(seed.seed));
    assert.ok(p.includes(seed.avoid[0]));
  }
  assert.ok(prompts[0].includes('dream inside this ground'));
  assert.ok(prompts[1].includes('reason inside this ground'));
  for (const f of ['turns.log', 'rejects.log', 'state.json']) assert.ok(!read(f).includes(seed.seed));
});

test('turn: a seed sentence never posts', async () => {
  const seed = pickSeed(seedDayNumber(), SEEDS);
  replies = [`Anthony, I keep coming back to ${seed.seed} and I cannot leave it.`];
  const r = await turn({ lastSpeaker: 'ANTHONY' });
  assert.equal(r.posted, false);
  assert.deepEqual(posts, []);
  assert.match(read('turns.log'), /\| SEED_LEAK\n$/);
  assert.match(read('rejects.log'), /\| SEED_LEAK \|/);
});

test('turn: re-prompt path, frame named, clean retry posts, one turns.log line', async () => {
  chamber = room([framePost(1), framePost(2), framePost(3)]);
  replies = [framePost(4), CLEAN];
  const r = await turn({ lastSpeaker: 'ANTHONY' });
  assert.equal(r.posted, true);
  assert.deepEqual(posts, [CLEAN]);
  assert.equal(prompts.length, 2);
  assert.ok(!prompts[0].includes('Do not use these names'));
  assert.ok(prompts[1].endsWith('Do not use these names, or anything built on them: Signal Thread, Signal.'));
  assert.equal(read('turns.log').trim().split('\n').length, 1);
  assert.match(read('turns.log'), /POSTED m1/);
  assert.match(read('rejects.log'), /\| REPEAT_FRAME \|/);
});

test('turn: a head or label rejection re-prompts naming the token: Signal', async () => {
  chamber = room(DISTINCT.slice(0, 3).map((pair, i) => namedPost(pair, i)));
  replies = [namedPost(DISTINCT[3], 9), CLEAN];
  const heads = await turn({ lastSpeaker: 'ANTHONY' });
  assert.equal(heads.posted, true);
  assert.ok(prompts[1].endsWith('Do not use these names, or anything built on them: Signal.'));

  prompts = [];
  chamber = room([labelPost(1), labelPost(2), labelPost(3)]);
  replies = [labelPost(4), CLEAN.replace('Anthony', 'Beatrix')];
  const labels = await turn({ lastSpeaker: 'ANTHONY' });
  assert.equal(labels.posted, true);
  assert.ok(prompts[1].endsWith('Do not use these names, or anything built on them: Signal.'));
});

test('turn: a lowercase watch hit re-prompts naming it, and a second failure does not post', async () => {
  chamber = room([lowerPost(1), lowerPost(2), lowerPost(3)]);
  replies = [lowerPost(4), CLEAN];
  assert.equal((await turn({ lastSpeaker: 'ANTHONY' })).posted, true);
  assert.ok(prompts[1].endsWith('Do not use these names, or anything built on them: signal.'));

  prompts = [];
  posts = [];
  replies = [lowerPost(5), lowerPost(6)];
  assert.equal((await turn({ lastSpeaker: 'ANTHONY' })).posted, false);
  assert.deepEqual(posts, []);
  assert.equal(prompts.length, 2);
  assert.match(read('turns.log'), /\| REPEAT_FRAME\n$/);
});

test('turn: skip path, two failures, no post, logged, in the rejects.log format', async () => {
  chamber = room([framePost(1), framePost(2), framePost(3)]);
  replies = [framePost(4), framePost(5)];
  const r = await turn({ lastSpeaker: 'ANTHONY' });
  assert.equal(r.posted, false);
  assert.deepEqual(posts, []);
  assert.equal(prompts.length, 2);
  assert.match(read('turns.log'), /\| BEATRIX \| REPEAT_FRAME\n$/);
  assert.equal(read('rejects.log').trim().split('\n').length, 2);
  assert.match(read('rejects.log'), /^\S+Z \| BEATRIX \| REPEAT_FRAME \| Anthony, the Signal Thread/);
});

test('turn: a retry failing another rule logs that reason and does not post', async () => {
  chamber = room([framePost(1), framePost(2), framePost(3)]);
  replies = [framePost(4), 'Anthony, the sky over the colony is wide this morning.'];
  const r = await turn({ lastSpeaker: 'ANTHONY' });
  assert.equal(r.posted, false);
  assert.deepEqual(posts, []);
  assert.match(read('turns.log'), /\| STYLE\n$/);
});

test('turn: REPEAT sees 12, the frame check sees 20', async () => {
  const old = 'Anthony, an old line from fifteen turns back stays worth saying again.';
  chamber = room([old, ...Array.from({ length: 19 }, (_, i) => plainPost(i))]);
  replies = [old];
  const r = await turn({ lastSpeaker: 'ANTHONY' });
  assert.equal(r.posted, true); // past the 12: REPEAT is unchanged

  chamber = room([framePost(1), framePost(2), framePost(3), ...Array.from({ length: 17 }, (_, i) => plainPost(i))]);
  replies = [framePost(4), CLEAN];
  await turn({ lastSpeaker: 'ANTHONY' });
  assert.match(read('rejects.log'), /REPEAT_FRAME/); // 18 to 20 back still counts
});
