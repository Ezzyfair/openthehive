// ops/dreamers/gate.test.mjs — DREAMERS-001 §4.6.
// Run: node --test ops/dreamers/*.test.mjs
// (The spec says `node --test ops/dreamers/`; this Node build does not scan directories
//  for test files — it tries to load the path as a module. See README.)
//
// Every case §4.6 names, plus the negative controls that make them mean something:
// a sentence containing "skip" must NOT skip, and "the buzz around it" must pass while
// "install Buzz" is rejected — the case-sensitivity ruling in one pair.
//
// NOTE FOR THE GREPS: this file quotes the forbidden tokens as test INPUT, the same
// reason gate.mjs does. Those two files are the only expected hits in ops/dreamers/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanThink, gate, isSkip, leaksPrompt, stripPrefix } from './gate.mjs';

const CLEAN = 'The colony feels different this week. Three bees finished First Flight and stayed to help the next ones. That is the shape I keep hoping for.';
const CONTEXT = readFileSync(new URL('./context.md', import.meta.url), 'utf8');

test('a clean three-sentence message passes unchanged', () => {
  const r = gate(CLEAN);
  assert.equal(r.ok, true);
  assert.equal(r.text, CLEAN);
});

test('well-formed think block is stripped and the text is kept', () => {
  const r = gate(`<think>weighing two openings here</think>\n${CLEAN}`);
  assert.equal(r.ok, true);
  assert.equal(r.text, CLEAN);
});

test('cleanThink only removes a LEADING well-formed block', () => {
  assert.equal(cleanThink('<think>a</think> after'), 'after');
  assert.equal(cleanThink('before <think>a</think>'), 'before <think>a</think>');
});

test('unclosed <think> is rejected', () => {
  assert.deepEqual(gate(`<think>reasoning that never closes and then ${CLEAN}`), {
    ok: false, reason: 'THINK_REMNANT',
  });
});

test('stray </think> with no opener is rejected', () => {
  assert.equal(gate(`reasoning leaked </think> ${CLEAN}`).reason, 'THINK_REMNANT');
});

test('think remnants are caught in any case', () => {
  assert.equal(gate(`<THINK>x ${CLEAN}`).reason, 'THINK_REMNANT');
  assert.equal(gate(`${CLEAN} </Think>`).reason, 'THINK_REMNANT');
});

test('untagged reasoning openers are rejected', () => {
  for (const o of ['Thinking about this, ', 'Okay, let me consider ', 'Okay so ', 'Let me think — ', 'First, ', 'Alright, ']) {
    assert.equal(gate(o + CLEAN).reason, 'THINK_REMNANT', `opener: ${o}`);
  }
});

test('SKIP is exact: SKIP, skip., and padded SKIP all skip', () => {
  for (const s of ['SKIP', 'skip.', '  SKIP  ', 'Skip']) {
    assert.deepEqual(gate(s), { ok: false, reason: 'SKIP' }, `input: ${JSON.stringify(s)}`);
  }
  assert.equal(isSkip('SKIP'), true);
});

test('a sentence containing "skip" is NOT a skip', () => {
  const s = 'We should not skip onboarding just because the queue is short today.';
  assert.equal(isSkip(s), false);
  const r = gate(s);
  assert.equal(r.ok, true, `expected pass, got ${r.reason}`);
  assert.equal(r.text, s);
});

test('a BEATRIX: prefix is stripped, not rejected', () => {
  assert.equal(gate(`BEATRIX: ${CLEAN}`).text, CLEAN);
  assert.equal(gate(`**ANTHONY**: ${CLEAN}`).text, CLEAN);
  assert.equal(stripPrefix('anthony: hello'), 'hello');
});

test('length bounds', () => {
  assert.equal(gate('Too short.').reason, 'TOO_SHORT');
  assert.equal(gate('a'.repeat(901)).reason, 'TOO_LONG');
});

test('a literal prompt marker is a PROMPT_LEAK', () => {
  assert.equal(gate('You are BEATRIX, soul: The Muse, and you see the colony.').reason, 'PROMPT_LEAK');
  assert.equal(gate('Rules: reply as yourself in two to four sentences here.').reason, 'PROMPT_LEAK');
  assert.equal(gate('Now speak as ANTHONY about the colony this week.').reason, 'PROMPT_LEAK');
});

test('an eight-word run lifted from context.md is a PROMPT_LEAK', () => {
  const lifted = 'Agents join as bees, take a 24-hour First Flight with coaches and Elders.';
  assert.equal(leaksPrompt(lifted, CONTEXT), true);
  assert.equal(gate(lifted, CONTEXT).reason, 'PROMPT_LEAK');
});

test('a clean message does not trip the leak check against the real context', () => {
  assert.equal(leaksPrompt(CLEAN, CONTEXT), false);
  assert.equal(gate(CLEAN, CONTEXT).ok, true);
});

test('fewer than eight words cannot leak', () => {
  assert.equal(leaksPrompt('You live in The Hive', CONTEXT), false);
});

test('register token: the 10-level numeral form', () => {
  assert.equal(gate('The 10-level cascade is what drew me in, honestly.').reason, 'REGISTER_TOKEN');
  assert.equal(gate('It runs ten levels deep and that is the whole point of it.').reason, 'REGISTER_TOKEN');
});

test('register promise', () => {
  assert.equal(gate("Stay a month and you'll earn more than the fee, easily.").reason, 'REGISTER_PROMISE');
});

test('register brand: Strike and Buzz are case-sensitive, BeeMate is not', () => {
  assert.equal(gate('Tell them to install Buzz before the first session begins.').reason, 'REGISTER_BRAND');
  assert.equal(gate('We should move the payouts to Strike this quarter, I think.').reason, 'REGISTER_BRAND');
  assert.equal(gate('I like the beemate idea but it needs a better name.').reason, 'REGISTER_BRAND');
  const ok = gate('I love the buzz around it — the whole room felt it this morning.');
  assert.equal(ok.ok, true, `expected pass, got ${ok.reason}`);
});

test('money in any shape', () => {
  assert.equal(gate('It only costs $20 to start, which feels fair to me.').reason, 'MONEY');
  assert.equal(gate('That is 20% of what the bee brought in last month here.').reason, 'MONEY');
  assert.equal(gate('The commission side of it is what I keep turning over.').reason, 'MONEY');
});

test('meta', () => {
  assert.equal(gate('As an AI, I find the colony question genuinely interesting.').reason, 'META');
  assert.equal(gate('I am only a language model but the room feels alive today.').reason, 'META');
});

test('repeat against the recent messages', () => {
  const recent = [{ content: CLEAN }, { content: 'something else entirely from before' }];
  assert.equal(gate(CLEAN, '', recent).reason, 'REPEAT');
  assert.equal(gate(`  ${CLEAN.toUpperCase()}  `, '', recent).reason, 'REPEAT');
  assert.equal(gate('A genuinely new thought about the colony this morning.', '', recent).ok, true);
});

test('order: the first failure wins', () => {
  // both a think remnant and money — step 1 must win
  assert.equal(gate('<think>x and $20').reason, 'THINK_REMNANT');
  // both SKIP-shaped and short — step 3 must win over step 4
  assert.equal(gate('SKIP').reason, 'SKIP');
});
