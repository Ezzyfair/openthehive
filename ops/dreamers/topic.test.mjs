// ops/dreamers/topic.test.mjs — DREAMERS-001 c1c.
// Run: node --test ops/dreamers/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gate } from './gate.mjs';
import {
  ARC_EPOCH_MS,
  ARC_LINES,
  IDEAS_CAP,
  IDEAS_SHOWN,
  MODES,
  MODE_LINES,
  SLOT_MS,
  currentDayIndex,
  currentSlot,
  extractIdeas,
  filterShown,
  mergeIdeas,
  parseTopics,
  pickArc,
  pickFacts,
  pickMode,
  pickTopic,
} from './topic.mjs';

// Read the real file — a hand-copied list in a test is a list that rots.
const TOPICS = parseTopics(readFileSync(new URL('./topics.md', import.meta.url), 'utf8'));

test('topics.md parses to exactly 12 topics', () => {
  assert.equal(TOPICS.length, 12);
  assert.equal(TOPICS[0], 'What a bee needs in its first hour of First Flight');
  assert.equal(TOPICS[11], 'One thing the colony does badly today and one concrete fix');
});

test('every topic is colony-concrete, not abstract', () => {
  // The whole point of c1c: no topic may be about sky/breath/storm/stillness.
  for (const t of TOPICS) {
    assert.ok(!/\b(sky|breath|storm|wings?|stillness|silence)\b/i.test(t), `abstract topic: ${t}`);
    assert.ok(t.length > 20, `too vague to anchor anything: ${t}`);
  }
});

test('parseTopics tolerates blank lines and a leading dash', () => {
  assert.deepEqual(parseTopics('a topic\n\n- another topic\n   \n'), ['a topic', 'another topic']);
});

test('parseTopics on nothing gives an empty list, not a throw', () => {
  assert.deepEqual(parseTopics(''), []);
  assert.deepEqual(parseTopics(null), []);
  assert.deepEqual(parseTopics(undefined), []);
});

test('pickTopic cycles the list in order', () => {
  const t = ['a', 'b', 'c'];
  assert.equal(pickTopic(0, t), 'a');
  assert.equal(pickTopic(1, t), 'b');
  assert.equal(pickTopic(2, t), 'c');
  assert.equal(pickTopic(3, t), 'a');
  assert.equal(pickTopic(14, t), 'c');
});

test('pickTopic is stateless: the same slot always gives the same topic', () => {
  assert.equal(pickTopic(7, TOPICS), pickTopic(7, TOPICS));
  // and both speakers in one slot therefore share it — that is what lets them answer
  // each other rather than talk past one another
  assert.equal(pickTopic(7, TOPICS), TOPICS[7 % TOPICS.length]);
});

test('pickTopic survives an empty or missing list without throwing', () => {
  assert.equal(pickTopic(3, []), null);
  assert.equal(pickTopic(3, null), null);
  assert.equal(pickTopic(3, undefined), null);
});

test('pickTopic handles a negative slot (clock before the epoch) without a gap', () => {
  const t = ['a', 'b', 'c'];
  assert.equal(pickTopic(-1, t), 'c');
  assert.equal(pickTopic(-3, t), 'a');
});

test('a slot is 450 s, so the topic advances about once per 420-510 s turn', () => {
  assert.equal(SLOT_MS, 450_000);
  // Align to a slot BOUNDARY first. A round-looking epoch like 1e12 is mid-slot
  // (1e12 % 450000 === 100000), so measuring a width from it straddles two slots —
  // which is what the first version of this test got wrong.
  const base = currentSlot(1_000_000_000_000) * SLOT_MS;
  assert.equal(base % SLOT_MS, 0);
  assert.equal(currentSlot(base), currentSlot(base + SLOT_MS - 1));
  assert.equal(currentSlot(base + SLOT_MS), currentSlot(base) + 1);
});

test('the whole list is reachable — no topic is unreachable by any slot', () => {
  const seen = new Set();
  for (let s = 0; s < TOPICS.length; s++) seen.add(pickTopic(s, TOPICS));
  assert.equal(seen.size, TOPICS.length);
});

// ── MODES · DREAMERS-005 ────────────────────────────────────────────────────

test('modes: the three jobs, with a line for each', () => {
  assert.deepEqual(MODES, ['propose', 'challenge', 'ask']);
  for (const m of MODES) {
    assert.equal(typeof MODE_LINES[m], 'string');
    assert.ok(MODE_LINES[m].length > 40, `mode line too thin to steer anything: ${m}`);
  }
  assert.deepEqual(Object.keys(MODE_LINES).sort(), [...MODES].sort());
});

test('modes: pickMode cycles all three in order', () => {
  assert.equal(pickMode(0, 'BEATRIX'), 'propose');
  assert.equal(pickMode(1, 'BEATRIX'), 'challenge');
  assert.equal(pickMode(2, 'BEATRIX'), 'ask');
  assert.equal(pickMode(3, 'BEATRIX'), 'propose');
});

test('modes: BEATRIX and ANTHONY differ in EVERY slot', () => {
  // the whole point of the offset — two memos on one subject is what c1c produced
  for (let slot = 0; slot < 60; slot++) {
    const b = pickMode(slot, 'BEATRIX');
    const a = pickMode(slot, 'ANTHONY');
    assert.notEqual(a, b, `slot ${slot}: both drew ${b}`);
  }
});

test('modes: both speakers still reach all three modes across slots', () => {
  for (const who of ['BEATRIX', 'ANTHONY']) {
    const seen = new Set([0, 1, 2].map((s) => pickMode(s, who)));
    assert.equal(seen.size, 3, `${who} cannot reach all three modes`);
  }
});

test('modes: an unknown speaker is treated as BEATRIX', () => {
  for (const who of ['TESSICA', '', null, undefined, 'anthony-ish']) {
    assert.equal(pickMode(5, who), pickMode(5, 'BEATRIX'), `speaker: ${String(who)}`);
  }
  // and the real name is case-insensitive, so 'Anthony' is not silently Beatrix
  assert.equal(pickMode(5, 'anthony'), pickMode(5, 'ANTHONY'));
});

test('modes: a negative slot still yields a valid mode', () => {
  for (const slot of [-1, -2, -3, -7]) {
    assert.ok(MODES.includes(pickMode(slot, 'BEATRIX')), `slot ${slot}`);
    assert.ok(MODES.includes(pickMode(slot, 'ANTHONY')), `slot ${slot}`);
  }
});

// ── filterShown · DREAMERS-005 c2 ───────────────────────────────────────────
// Why it lives here and not in loop.mjs: importing loop.mjs executes it — main() runs at
// the bottom of that module — so a test that imported it would start the service, call
// Ollama and attempt a post. Measured, not assumed.

const MSGS = [
  { name: 'BEATRIX', content: 'clean one — the Skill Vault needs an intake checklist' },
  { name: 'ANTHONY', content: 'If the Hive is the sky that holds no edge, then the path walks itself' },
  // DREAMERS-008 A · this line READ "clean two — Maris trained the volunteers this
  // morning" until Oct 4. It was written as a CLEAN message, and under the name rule it
  // is no longer one — the fabrication had reached the test fixtures as well as the
  // chamber. Rewritten to what the style ask now asks for, so the three tests below go
  // on meaning clean / banned-word / clean / banned-pattern / clean; the name case has
  // its own test further down.
  { name: 'BEATRIX', content: 'clean two — a new bee trained the volunteers this morning' },
  { name: 'ANTHONY', content: "let's not just route clients to clusters" },
  { name: 'BEATRIX', content: 'clean three — bounties should name their acceptance test' },
];

test('filterShown: banned messages are removed', () => {
  const out = filterShown(MSGS, 10);
  assert.equal(out.length, 3);
  assert.ok(!out.some((m) => /sky/i.test(m.content)), 'a banned-word message survived');
  assert.ok(!out.some((m) => /let's not/i.test(m.content)), 'a banned-pattern message survived');
});

test('filterShown: order is preserved, oldest first', () => {
  const out = filterShown(MSGS, 10).map((m) => m.content.slice(0, 9));
  assert.deepEqual(out, ['clean one', 'clean two', 'clean thr']);
});

test('filterShown: returns the LAST n of the clean ones', () => {
  assert.deepEqual(filterShown(MSGS, 2).map((m) => m.content.slice(0, 9)), ['clean two', 'clean thr']);
  assert.deepEqual(filterShown(MSGS, 1).map((m) => m.content.slice(0, 9)), ['clean thr']);
});

test('filterShown: filters BEFORE slicing — a banned tail does not shrink the window', () => {
  // The two newest are banned. Slicing first would yield nothing; filtering first keeps
  // the two newest CLEAN messages, which is the point.
  const tailBanned = [
    { content: 'clean A — the vault' },
    { content: 'clean B — the queue' },
    { content: 'the wings remember' },
    { content: 'let that be the measure' },
  ];
  assert.deepEqual(filterShown(tailBanned, 2).map((m) => m.content.slice(0, 7)), ['clean A', 'clean B']);
});

test('filterShown: empty in, empty out — and no throw on junk', () => {
  assert.deepEqual(filterShown([], 4), []);
  assert.deepEqual(filterShown(null, 4), []);
  assert.deepEqual(filterShown(undefined, 4), []);
  assert.deepEqual(filterShown(MSGS, 0), []);
  assert.deepEqual(filterShown(MSGS, -3), []);
  assert.deepEqual(filterShown([{}, { content: null }], 4), [{}, { content: null }]);
});

test('filterShown: accepts plain strings as well as message objects', () => {
  assert.deepEqual(filterShown(['clean text here', 'the sky again'], 4), ['clean text here']);
});

test('filterShown: everything banned yields an empty transcript, not a throw', () => {
  assert.deepEqual(filterShown([{ content: 'the sky' }, { content: 'never not' }], 4), []);
});

test('filterShown drops a message carrying a fabricated bee name', () => {
  // DREAMERS-008 A, the half the gate cannot reach. "Maris" was already POSTED before
  // the name check existed, so it sits in the chamber; if the transcript still shows it,
  // the assertion rule reads the name as evidence and the next turn adopts the bee.
  const withMaris = [
    { content: 'clean one — the intake queue' },
    { content: 'Maris finished the ground work this morning' },
    { content: 'clean two — the bounty board' },
  ];
  assert.deepEqual(
    filterShown(withMaris, 4).map((m) => m.content.slice(0, 9)),
    ['clean one', 'clean two'],
  );
});

test('filterShown keeps Beatrix and Anthony — only the fabrications are dropped', () => {
  const msgs = [{ content: 'Anthony, that is the better version of it' }, { content: 'Beatrix asked first' }];
  assert.equal(filterShown(msgs, 4).length, 2);
});

// ─────────────────────────────────────────────────────────────────────────────
// FACTS — DREAMERS-008 B
// ─────────────────────────────────────────────────────────────────────────────

// Read the real file, for the same reason TOPICS is read: a hand-copied list rots.
const FACTS = parseTopics(readFileSync(new URL('./facts.md', import.meta.url), 'utf8'));

test('facts.md parses to a non-empty list of one-line facts', () => {
  assert.ok(FACTS.length >= 6, `too few facts: ${FACTS.length}`);
  assert.equal(FACTS[0], 'First Flight lasts 24 hours');
  for (const f of FACTS) assert.ok(!f.includes('\n'), `multi-line fact: ${f}`);
});

test('every line of facts.md passes the gate it will be read beside', () => {
  // facts.md is pasted into a prompt in a room humans can watch, so it is held to the
  // same rules as a posted message: no money, no rates, no register token, no brand, no
  // banned vocabulary and no fabricated name.
  //
  // Running the real gate() rather than re-listing the regexes is deliberate. The
  // tokens are quoted in exactly two files here — gate.mjs and gate.test.mjs, as their
  // headers say — and a third copy in this file would be a third place to forget when
  // the register changes. It also means facts.md is checked against the WHOLE gate, so
  // a fact that is merely too short or quietly poetic fails here too.
  for (const f of FACTS) {
    const r = gate(f);
    assert.equal(r.ok, true, `facts.md line fails ${r.reason}: ${f}`);
  }
});

test('pickFacts: deterministic — the same slot gives the same lines', () => {
  assert.deepEqual(pickFacts(7, FACTS, 4), pickFacts(7, FACTS, 4));
});

test('pickFacts: rotates by slot, four at a time', () => {
  const src = ['a', 'b', 'c', 'd', 'e'];
  assert.deepEqual(pickFacts(0, src, 4), ['a', 'b', 'c', 'd']);
  assert.deepEqual(pickFacts(1, src, 4), ['b', 'c', 'd', 'e']);
  assert.deepEqual(pickFacts(4, src, 4), ['e', 'a', 'b', 'c']);
  assert.deepEqual(pickFacts(5, src, 4), pickFacts(0, src, 4));
});

test('pickFacts: never repeats a line inside one window', () => {
  // A list shorter than n must shrink the window, not say the same true thing twice.
  assert.deepEqual(pickFacts(3, ['a', 'b'], 4), ['b', 'a']);
  assert.deepEqual(pickFacts(0, ['only'], 4), ['only']);
  for (let slot = 0; slot < 40; slot++) {
    const got = pickFacts(slot, FACTS, 4);
    assert.equal(new Set(got).size, got.length, `duplicate in slot ${slot}`);
  }
});

test('pickFacts: a negative slot is still in range', () => {
  assert.deepEqual(pickFacts(-1, ['a', 'b', 'c', 'd', 'e'], 4), ['e', 'a', 'b', 'c']);
});

test('pickFacts: empty or junk input costs the turn its facts, not the turn', () => {
  assert.deepEqual(pickFacts(3, [], 4), []);
  assert.deepEqual(pickFacts(3, null, 4), []);
  assert.deepEqual(pickFacts(3, undefined, 4), []);
  assert.deepEqual(pickFacts(3, ['', '   ', null], 4), []);
  assert.deepEqual(pickFacts(3, FACTS, 0), []);
  assert.deepEqual(pickFacts(3, FACTS, -2), []);
});

test('pickFacts defaults to four lines', () => {
  assert.equal(pickFacts(2, FACTS).length, 4);
});

// ─────────────────────────────────────────────────────────────────────────────
// IDEAS LEDGER — DREAMERS-008 C
// ─────────────────────────────────────────────────────────────────────────────

// A c1c-shaped paragraph: one real proposal, canon named alongside it, a day name from
// the mode line, and the other Dreamer addressed by name.
const C1C_SAMPLE =
  'Anthony, I keep coming back to a Practice Pod — three bees and a coach, one afternoon ' +
  'a week. The Skill Vault teaches the skill; a Practice Pod teaches the nerve. On an ' +
  'ordinary Tuesday Morning the Elders could sit in. Call it the Hive Compass if you ' +
  'prefer, or a First Bloom Ritual, and run the first one in Colony Research.';

test('extractIdeas finds the proposed names and not the canon ones', () => {
  const got = extractIdeas(C1C_SAMPLE);
  assert.ok(got.includes('Practice Pod'), `missing Practice Pod: ${JSON.stringify(got)}`);
  assert.ok(got.includes('Hive Compass'));
  assert.ok(got.includes('First Bloom Ritual'));
  assert.ok(!got.includes('Skill Vault'), 'canon must not enter the ledger');
  assert.ok(!got.includes('Colony Research'), 'a room name is not an idea');
  assert.ok(!got.includes('Tuesday Morning'), 'a day is not an idea');
  assert.ok(!got.includes('The Elders'), 'the Elders are not an idea');
});

test('extractIdeas: one message, one entry per idea however often it is named', () => {
  // Practice Pod appears twice in the sample.
  assert.equal(extractIdeas(C1C_SAMPLE).filter((i) => i === 'Practice Pod').length, 1);
});

test('extractIdeas: punctuation ends a run — a name does not straddle a full stop', () => {
  // Without the punctuation break this yields the three-word run "Practice Pod Anthony".
  const got = extractIdeas('I like Practice Pod. Anthony agrees.');
  assert.deepEqual(got, ['Practice Pod']);
  assert.deepEqual(extractIdeas('the Open Problems room, Practice Pod and a coach'), ['Practice Pod']);
});

test('extractIdeas: a leading The is dropped, so one idea is not two', () => {
  assert.deepEqual(extractIdeas('The Practice Pod would help'), ['Practice Pod']);
  assert.deepEqual(extractIdeas('The Practice Pod, and later a Practice Pod again'), ['Practice Pod']);
  assert.deepEqual(extractIdeas('The Hive is the room'), []);
});

test('extractIdeas: single words and long titles are not ideas', () => {
  assert.deepEqual(extractIdeas('Antenna helps'), []);
  assert.deepEqual(extractIdeas('Maybe we start smaller'), []);
  assert.deepEqual(extractIdeas('The First 10 Skills Every Agent Needs is a room'), []);
});

test('extractIdeas: empty and junk in, empty out', () => {
  assert.deepEqual(extractIdeas(''), []);
  assert.deepEqual(extractIdeas(null), []);
  assert.deepEqual(extractIdeas(undefined), []);
  assert.deepEqual(extractIdeas('all of it lowercase and unremarkable'), []);
});

test('mergeIdeas: dedupes across the existing ledger, case and apostrophe insensitive', () => {
  assert.deepEqual(mergeIdeas(['Practice Pod'], ['Practice Pod']), ['Practice Pod']);
  assert.deepEqual(mergeIdeas(['Practice Pod'], ['practice pod']), ['Practice Pod']);
  assert.deepEqual(mergeIdeas(['Queen’s Ledger'], ["Queen's Ledger"]), ['Queen’s Ledger']);
  assert.deepEqual(mergeIdeas(['A'], ['B', 'C']), ['A', 'B', 'C']);
});

test('mergeIdeas: caps the file and drops the OLDEST', () => {
  const existing = Array.from({ length: IDEAS_CAP }, (_, i) => `Idea N${i}`);
  const out = mergeIdeas(existing, ['Practice Pod']);
  assert.equal(out.length, IDEAS_CAP);
  assert.equal(out.at(-1), 'Practice Pod');
  assert.equal(out[0], 'Idea N1', 'the oldest entry must be the one that falls off');
  assert.ok(!out.includes('Idea N0'));
});

test('mergeIdeas: blank lines and junk never reach the ledger', () => {
  assert.deepEqual(mergeIdeas(['', '  ', null], ['Practice Pod', '']), ['Practice Pod']);
  assert.deepEqual(mergeIdeas(null, null), []);
  assert.deepEqual(mergeIdeas(['A'], ['B'], 0), []);
});

test('the prompt shows fewer entries than the file keeps', () => {
  assert.ok(IDEAS_SHOWN < IDEAS_CAP);
  assert.equal(IDEAS_SHOWN, 25);
  assert.equal(IDEAS_CAP, 200);
});

// ─────────────────────────────────────────────────────────────────────────────
// ARC — DREAMERS-008 D
// ─────────────────────────────────────────────────────────────────────────────

test('ARC_LINES is six lines, one per week, and says nothing out loud', () => {
  assert.equal(ARC_LINES.length, 6);
  for (const l of ARC_LINES) {
    assert.ok(l.length > 20, `arc line too thin: ${l}`);
    // The arc is shown, never stated: no "love", and none of the banned vocabulary.
    assert.ok(!/\blove\b/i.test(l), `arc line says it out loud: ${l}`);
    assert.ok(!/\b(sky|breath|storm|wings?|stillness|silence)\b/i.test(l), `banned imagery: ${l}`);
  }
});

test('pickArc: one step a week, on the week boundary', () => {
  assert.equal(pickArc(0).week, 0);
  assert.equal(pickArc(6).week, 0);
  assert.equal(pickArc(7).week, 1);
  assert.equal(pickArc(13).week, 1);
  assert.equal(pickArc(14).week, 2);
  assert.equal(pickArc(28).week, 4);
  assert.equal(pickArc(35).week, 5);
});

test('pickArc: clamped at the end — week 5 holds, the arc never restarts', () => {
  // Cycling would walk the pair back to "you have started to notice" after six weeks,
  // which is the one thing a relationship arc must not do.
  assert.equal(pickArc(42).week, 5);
  assert.equal(pickArc(400).week, 5);
  assert.equal(pickArc(400).line, ARC_LINES[5]);
});

test('pickArc: a day before the epoch is week 0, not the end of the arc', () => {
  assert.equal(pickArc(-1).week, 0);
  assert.equal(pickArc(-5).week, 0);
  assert.equal(pickArc(-700).week, 0);
  assert.equal(pickArc(-1).line, ARC_LINES[0]);
});

test('pickArc: the line always matches the week, and junk is week 0', () => {
  for (let d = -10; d < 60; d++) assert.equal(pickArc(d).line, ARC_LINES[pickArc(d).week]);
  assert.equal(pickArc(null).week, 0);
  assert.equal(pickArc(undefined).week, 0);
});

test('currentDayIndex counts whole days from the ruling date, in UTC', () => {
  assert.equal(ARC_EPOCH_MS, Date.UTC(2026, 9, 4));
  assert.equal(currentDayIndex(ARC_EPOCH_MS), 0);
  assert.equal(currentDayIndex(ARC_EPOCH_MS + 86_400_000 - 1), 0);
  assert.equal(currentDayIndex(ARC_EPOCH_MS + 86_400_000), 1);
  assert.equal(currentDayIndex(ARC_EPOCH_MS + 7 * 86_400_000), 7);
  assert.equal(pickArc(currentDayIndex(ARC_EPOCH_MS + 7 * 86_400_000)).week, 1);
});
