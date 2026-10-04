// ops/dreamers/facts.test.mjs — DREAMERS-008 B.
// Run: node --test ops/dreamers/*.test.mjs
//
// The two PURE halves of facts.mjs. Nothing here touches the network: the fixture below
// is the markup /skills actually served on Oct 4, trimmed to one skill card per section
// plus the archetype card that must NOT be picked up. Importing facts.mjs is inert by
// the same entry-point guard as loop.mjs, so these run without a --refresh happening.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractSkillTitles, renderSkillsFile } from './facts.mjs';

// Measured from the live page. The 14px h4 is a skill; the 15px font-black h4 is a soul
// archetype and is the reason the extractor keys on the class rather than on <h4>.
const PAGE = `
<h3 class="text-[20px] font-black" style="color:#3B82F6">BUILD</h3>
<h4 class="text-[14px] font-bold text-hive-text mb-2">Structured Memory System</h4>
<h4 class="text-[14px] font-bold text-hive-text mb-2">Advanced Search Methods</h4>
<h4 class="text-[15px] font-black text-hive-text mb-2 group-hover:text-hive-gold transition-colors">The Oracle 🔮</h4>
<h3 class="text-[20px] font-black">AWAKEN</h3>
<h4 class="text-[14px] font-bold text-hive-text mb-2">Robust Solution Architecture</h4>
`;

test('extractSkillTitles finds the skill cards, in page order', () => {
  assert.deepEqual(extractSkillTitles(PAGE), [
    'Structured Memory System',
    'Advanced Search Methods',
    'Robust Solution Architecture',
  ]);
});

test('extractSkillTitles ignores the soul archetypes', () => {
  // "The Oracle" is a soul, not a skill. A looser <h4[^>]*> would have told the Dreamers
  // the Skill Vault contains fifteen things it does not contain.
  const got = extractSkillTitles(PAGE);
  assert.ok(!got.some((t) => /Oracle/.test(t)), `an archetype leaked in: ${JSON.stringify(got)}`);
});

test('extractSkillTitles decodes entities and collapses whitespace', () => {
  const html = '<h4 class="text-[14px] font-bold">Tools &amp;  Tactics</h4>' +
    '<h4 class="text-[14px] font-bold">The Queen&#39;s Brief</h4>';
  assert.deepEqual(extractSkillTitles(html), ['Tools & Tactics', "The Queen's Brief"]);
});

test('extractSkillTitles dedupes and drops empties', () => {
  const html =
    '<h4 class="text-[14px] font-bold">Same Skill</h4>' +
    '<h4 class="text-[14px] font-bold">Same Skill</h4>' +
    '<h4 class="text-[14px] font-bold">   </h4>';
  assert.deepEqual(extractSkillTitles(html), ['Same Skill']);
});

test('a page whose markup moved yields ZERO titles, not wrong ones', () => {
  // This is the case --refresh handles by writing nothing at all, which is why the
  // extractor is allowed to be strict about the class.
  assert.deepEqual(extractSkillTitles('<h4 class="text-[13px] font-semibold">Renamed Class</h4>'), []);
  assert.deepEqual(extractSkillTitles('<div>no headings at all</div>'), []);
  assert.deepEqual(extractSkillTitles(''), []);
  assert.deepEqual(extractSkillTitles(null), []);
});

test('extractSkillTitles is re-entrant — the module-level regex is reset each call', () => {
  // A /g regex reused across calls keeps lastIndex, so the second call would start
  // halfway down the page and silently return fewer titles.
  assert.deepEqual(extractSkillTitles(PAGE), extractSkillTitles(PAGE));
});

test('renderSkillsFile writes one prefixed fact per line, newline-terminated', () => {
  assert.equal(renderSkillsFile(['Alpha', 'Beta']), 'Skill Vault: Alpha\nSkill Vault: Beta\n');
  assert.equal(renderSkillsFile([]), '\n');
});

test('the rendered lines parse back as facts the loop can use', async () => {
  const { parseTopics, pickFacts } = await import('./topic.mjs');
  const lines = parseTopics(renderSkillsFile(extractSkillTitles(PAGE)));
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'Skill Vault: Structured Memory System');
  assert.equal(pickFacts(0, lines, 2).length, 2);
});
