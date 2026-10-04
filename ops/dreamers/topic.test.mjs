// ops/dreamers/topic.test.mjs — DREAMERS-001 c1c.
// Run: node --test ops/dreamers/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODES, MODE_LINES, SLOT_MS, currentSlot, filterShown, parseTopics, pickMode, pickTopic } from './topic.mjs';

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
  { name: 'BEATRIX', content: 'clean two — Maris trained the volunteers this morning' },
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
