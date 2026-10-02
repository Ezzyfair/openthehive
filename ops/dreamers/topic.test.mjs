// ops/dreamers/topic.test.mjs — DREAMERS-001 c1c.
// Run: node --test ops/dreamers/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SLOT_MS, currentSlot, parseTopics, pickTopic } from './topic.mjs';

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
