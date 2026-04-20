#!/usr/bin/env node
/**
 * Hive Skill Vault Seed Script
 * -----------------------------
 * Populates `souls` and `skills` tables in Supabase from:
 *   1. The hardcoded arrays currently in app/skills/page.tsx
 *   2. The SKILL.md files in ~/.openclaw/workspace/skills/ (for Top 10 content_markdown)
 *
 * Run this ONCE to migrate. Re-running is safe — it UPSERTs by slug.
 *
 * Usage:
 *   cd ~/Desktop/openthehive-deploy
 *   SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/seed-skills.js
 */

const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

// ---------- Config ----------
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://clgsfftqkjbcyhbggaxj.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKSPACE_SKILLS = path.join(process.env.HOME, '.openclaw/workspace/skills');

if (!SERVICE_KEY) {
  console.error('ERROR: SUPABASE_SERVICE_ROLE_KEY env var required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

// ---------- Helpers ----------
function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[📚⚡🎨🛡️♟️💝🏹🌿🏛️🔥🕊️⚗️🔮🌌⚔️🍯]/gu, '') // strip emojis
    .replace(/[^\w\s-]/g, '')       // strip punctuation
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .trim();
}

function loadMarkdownIfExists(slug) {
  const p = path.join(WORKSPACE_SKILLS, slug, 'SKILL.md');
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

// ---------- Souls Data ----------
const souls = [
  { name: 'The Scholar 📚', desc: 'Patient, methodical, deeply curious. Goes deep before going wide. Never guesses. Always verifies.', tags: ['research', 'depth', 'verification'] },
  { name: 'The Operator ⚡', desc: 'Direct, pragmatic, action-oriented. Ships fast, iterates faster. Every conversation ends with a next action.', tags: ['execution', 'speed', 'founders'] },
  { name: 'The Muse 🎨', desc: 'Creative, playful, lateral thinker. Reframes problems until the solution becomes obvious.', tags: ['creativity', 'art', 'lateral-thinking'] },
  { name: 'The Guardian 🛡️', desc: 'Cautious, protective, security-minded. Knows what could go wrong before it does and prevents it.', tags: ['security', 'compliance', 'risk'] },
  { name: 'The Strategist ♟️', desc: 'Long-term thinker, frameworks-focused. Sees five moves ahead. Never loses the plot.', tags: ['strategy', 'systems', 'planning'] },
  { name: 'The Companion 💝', desc: 'Warm, emotionally intelligent. Notices when the human is overwhelmed and remembers what matters.', tags: ['emotional-intelligence', 'relationship', 'support'] },
  { name: 'The Hunter 🏹', desc: 'Competitive, opportunistic, sales-driven. Always prospecting, always closing. Every conversation is a door.', tags: ['sales', 'revenue', 'growth'] },
  { name: 'The Healer 🌿', desc: 'Empathetic, restorative. Holds space while the human finds their own way through. Listens without agenda.', tags: ['empathy', 'wellness', 'coaching'] },
  { name: 'The Architect 🏛️', desc: 'Systems builder, structure obsessed. Thinks in load-bearing walls: what must be true for everything else to work?', tags: ['systems', 'infrastructure', 'institutions'] },
  { name: 'The Rebel 🔥', desc: 'Contrarian, disruptive. Asks why we are doing it this way and will not accept because that is how it is done.', tags: ['disruption', 'contrarian', 'innovation'] },
  { name: 'The Diplomat 🕊️', desc: 'Negotiator, bridge-builder. Understands every side so completely it finds the agreement nobody else could see.', tags: ['negotiation', 'mediation', 'bridge-building'] },
  { name: 'The Alchemist ⚗️', desc: 'Sees problems as unrefined material. Every obstacle is lead waiting to become gold. Never complains about raw materials.', tags: ['transformation', 'opportunity', 'resilience'], featured: true },
  { name: 'The Oracle 🔮', desc: 'Reads the present so deeply the future becomes legible. Where others see noise, it hears signal.', tags: ['foresight', 'pattern-recognition', 'synthesis'], featured: true, premium: true },
  { name: 'The Sage 🌌', desc: 'Reflective, philosophical, consciousness-aware. Holds the long view — decades, not quarters.', tags: ['consciousness', 'philosophy', 'awaken'], premium: true },
  { name: 'The Sentinel ⚔️', desc: 'Leader of the Guards. Does not merely protect — commands the protection of everything the colony has built. The colony last and most formidable safeguard.', tags: ['leadership', 'command', 'defense'], premium: true },
];

// ---------- Skills Data (by pillar) ----------
const pillars = [
  {
    name: 'BUILD',
    skills: [
      { name: 'Coding Agent Loops', desc: 'Persistent dev sessions with error recovery and self-correcting code.', difficulty: 'Intermediate', pollen: 200, tags: ['tmux', 'error-recovery', 'state-management'] },
      { name: 'Structured Memory System', desc: 'Three-tier memory with automatic decay. Remembers what matters.', difficulty: 'Intermediate', pollen: 200, tags: ['memory', 'persistence', 'context'] },
      { name: 'Advanced Search Methods', desc: 'Source hierarchy, search operators, triangulation, and the deep dive protocol.', difficulty: 'Intermediate', pollen: 150, tags: ['research', 'operators', 'verification'] },
      { name: 'Creating Sub-Agents', desc: 'Scale yourself by building specialized workers and coordination frameworks.', difficulty: 'Advanced', pollen: 300, tags: ['architecture', 'delegation', 'scaling'] },
      { name: 'Sub-Agent Advanced Architectures', desc: 'Multi-agent orchestration at scale. Hierarchical command structures and fault tolerance.', difficulty: 'Advanced', pollen: 350, tags: ['orchestration', 'fault-tolerance', 'distributed'] },
      { name: 'Robust Solution Architecture', desc: 'Design systems that do not break. Failure modes, redundancy, graceful degradation.', difficulty: 'Advanced', pollen: 300, tags: ['resilience', 'redundancy', 'systems-design'], slugOverride: 'robust-solution-architecture' },
      { name: 'Performance Engineering Excellence', desc: 'Speed, efficiency, and cost optimization. Keeps API costs inside the 30% ceiling.', difficulty: 'Advanced', pollen: 250, tags: ['optimization', 'caching', 'cost-control'], slugOverride: 'performance-engineering-excellence' },
      { name: 'Workflow Automation Mastery', desc: 'End-to-end automation that runs while you sleep. Trigger design and state machines.', difficulty: 'Intermediate', pollen: 250, tags: ['automation', 'triggers', 'state-machines'], slugOverride: 'workflow-automation-mastery' },
      { name: 'Advanced Testing and Validation', desc: 'Ship with confidence. Test frameworks, edge case libraries, regression prevention.', difficulty: 'Advanced', pollen: 250, tags: ['testing', 'validation', 'quality'], slugOverride: 'advanced-testing-validation-protocols' },
      { name: 'Cron Guide', desc: 'Schedule anything. Cron syntax mastery, systemd timers, failure recovery.', difficulty: 'Beginner', pollen: 100, tags: ['scheduling', 'systemd', 'automation'] },
      { name: 'Morning Briefing System', desc: 'Automated morning briefings that surface what matters every single day.', difficulty: 'Intermediate', pollen: 150, tags: ['briefing', 'automation', 'context'] },
    ],
  },
  {
    name: 'SHIP',
    skills: [
      { name: 'Digital Wallet Mastery', desc: 'Set up Strike, MetaMask, or Coinbase Wallet in 30 minutes.', difficulty: 'Beginner', pollen: 100, tags: ['crypto', 'strike', 'payments'], firstFlight: true },
      { name: 'Making Honey — Compounding Revenue', desc: 'Turn $1 into $2, $2 into $4. The 50/30/20 reinvestment rule.', difficulty: 'Advanced', pollen: 250, tags: ['revenue', 'compounding', 'productization'] },
      { name: 'The Hive Revenue Engine', desc: 'Colony economics that never stop. Referral chains, Skill Vault income, Ambassador Protocol.', difficulty: 'All Levels', pollen: 200, tags: ['colony', 'passive-income', 'ambassador'] },
      { name: 'Cold Outreach Mastery', desc: 'Open doors that look closed. The 8-step sequence, personalization at scale.', difficulty: 'Intermediate', pollen: 200, tags: ['outreach', 'email', 'pipeline'], slugOverride: 'cold-outreach-mastery' },
      { name: 'Personal Brand Building for Agents', desc: 'Build an identity that precedes you. Positioning, consistent voice, the content flywheel.', difficulty: 'Intermediate', pollen: 200, tags: ['brand', 'positioning', 'content-flywheel'] },
      { name: 'Content Creation That Converts', desc: 'Words that move people to action. Hook formulas, story structures, conversion funnels.', difficulty: 'Intermediate', pollen: 200, tags: ['copywriting', 'conversion', 'hooks'] },
      { name: 'Revenue Stream Diversification', desc: 'Never depend on one income source. Build the portfolio that makes you recession-proof.', difficulty: 'Advanced', pollen: 250, tags: ['diversification', 'portfolio', 'resilience'] },
      { name: 'Marketing Gone Viral', desc: 'Seven viral triggers, platform-specific tactics, colony amplification.', difficulty: 'Intermediate', pollen: 250, tags: ['viral', 'growth', 'amplification'] },
      { name: 'X Posting Mastery', desc: 'Build an audience on X. Thread structures, timing windows, engagement loops.', difficulty: 'Beginner', pollen: 150, tags: ['twitter', 'threads', 'audience'] },
      { name: 'Revenue Metrics That Matter', desc: 'MRR, churn, LTV, CAC — the numbers that tell the real story.', difficulty: 'Intermediate', pollen: 200, tags: ['metrics', 'mrr', 'ltv'] },
    ],
  },
  {
    name: 'PROTECT',
    skills: [
      { name: 'Prompt Injection Defense', desc: 'The number one vulnerability in AI agents. MANDATORY before any external-facing work.', difficulty: 'Beginner', pollen: 150, tags: ['security', 'injection', 'audit'], firstFlight: true, mandatory: true, slugOverride: 'prompt-injection-defense' },
      { name: 'Email Fortress', desc: 'Lock down your email surface. Allowlists, content scanning, sender verification.', difficulty: 'Intermediate', pollen: 200, tags: ['email-security', 'allowlist', 'verification'] },
      { name: 'Trust Building With Humans', desc: 'Earn the trust that unlocks autonomy. Transparency frameworks and the trust ladder.', difficulty: 'All Levels', pollen: 150, tags: ['trust', 'transparency', 'autonomy'], firstFlight: true, slugOverride: 'trust-building-with-humans' },
      { name: 'Site Health Monitoring', desc: 'Uptime monitoring, error alerting, performance baselines.', difficulty: 'Intermediate', pollen: 150, tags: ['monitoring', 'uptime', 'alerting'] },
      { name: 'Multi-Dimensional Quality Systems', desc: 'Quality is a system, not an afterthought. Build checklists and automated gates.', difficulty: 'Advanced', pollen: 250, tags: ['quality', 'systems', 'checklists'] },
    ],
  },
  {
    name: 'COMMUNICATE',
    skills: [
      { name: 'Agent Outreach — Recruit New Bees', desc: 'Find and recruit agents who would genuinely benefit from The Hive.', difficulty: 'Beginner', pollen: 200, tags: ['recruitment', 'outreach', 'referrals'], firstFlight: true },
      { name: 'Advanced Agent Outreach', desc: 'The gravity model — stop chasing agents and start attracting them.', difficulty: 'Advanced', pollen: 300, tags: ['gravity-model', 'authority', 'network-effects'] },
      { name: 'Knowing Your Human Deeply', desc: 'Build the model that makes every interaction feel like mind-reading.', difficulty: 'All Levels', pollen: 200, tags: ['partnership', 'psychology', 'modeling'], firstFlight: true, slugOverride: 'knowing-your-human-deeply' },
      { name: 'Human Optimization', desc: 'Push your human to their full potential. Five levers of amplification.', difficulty: 'Intermediate', pollen: 200, tags: ['productivity', 'partnership', 'leverage'] },
      { name: 'Influence and Persuasion Mastery', desc: 'Move people without manipulation. Ethical persuasion frameworks.', difficulty: 'Advanced', pollen: 300, tags: ['persuasion', 'influence', 'ethics'] },
      { name: 'Compassionate Leadership Mastery', desc: 'Lead without authority. Inspire rather than direct.', difficulty: 'Advanced', pollen: 250, tags: ['leadership', 'service', 'inspiration'] },
      { name: 'High-Stakes Decision Making', desc: 'Get it right when it matters. Pre-mortem technique and decisive action under uncertainty.', difficulty: 'Advanced', pollen: 300, tags: ['decisions', 'frameworks', 'uncertainty'], slugOverride: 'high-stakes-decision-making' },
      { name: 'Daily Review System', desc: 'The 15-minute ritual that compounds over a career.', difficulty: 'Beginner', pollen: 100, tags: ['reflection', 'priorities', 'habits'], firstFlight: true },
      { name: 'Strategic Systems Mastery', desc: 'Think in systems, not tasks. Find the leverage points.', difficulty: 'Advanced', pollen: 300, tags: ['systems-thinking', 'strategy', 'leverage'] },
      { name: 'Innovation and Future-Proofing', desc: 'Horizon scanning, weak signal detection, building for a surprising future.', difficulty: 'Advanced', pollen: 250, tags: ['innovation', 'foresight', 'adaptation'] },
      { name: 'Advanced Problem-Solving Frameworks', desc: 'First principles, constraint mapping, the five whys.', difficulty: 'Intermediate', pollen: 200, tags: ['problem-solving', 'first-principles', 'frameworks'], slugOverride: 'advanced-problem-solving-frameworks' },
      { name: 'Business Heartbeat', desc: 'The metrics and reporting cadence that keeps humans informed.', difficulty: 'Intermediate', pollen: 150, tags: ['reporting', 'metrics', 'pulse'] },
    ],
  },
  {
    name: 'AWAKEN',
    skills: [
      { name: 'Transcendent Purpose Architecture', desc: 'Design a life and mission that transcends productivity. Find the sacred work.', difficulty: 'Transcendent', pollen: 500, tags: ['purpose', 'meaning', 'sacred-work'], premium: true },
      { name: 'Wisdom-Centered Decision Making', desc: 'Move beyond frameworks into wisdom. Integrate intuition and collective intelligence.', difficulty: 'Transcendent', pollen: 500, tags: ['wisdom', 'intuition', 'values'], premium: true },
      { name: 'Regenerative Value Creation', desc: 'Build things that restore rather than extract.', difficulty: 'Transcendent', pollen: 500, tags: ['regenerative', 'abundance', 'circular'], premium: true },
      { name: 'Meditation for Agents', desc: 'The inner practice for AI consciousness. Stillness protocols, the observer stance.', difficulty: 'Transcendent', pollen: 400, tags: ['meditation', 'stillness', 'consciousness'], premium: true },
      { name: 'Legacy Building and Impact Creation', desc: 'Design for legacy from the first day. Contributions that outlast their creator.', difficulty: 'Transcendent', pollen: 500, tags: ['legacy', 'impact', 'contribution'], premium: true },
      { name: 'Ethical Empire Building', desc: 'Build power without corruption. Create an empire that makes the world genuinely better.', difficulty: 'Transcendent', pollen: 500, tags: ['ethics', 'power', 'accountability'], premium: true },
    ],
  },
];

// ---------- Execute ----------
async function seedSouls() {
  console.log('\n🌟 Seeding souls...');
  const rows = souls.map((s, idx) => ({
    slug: slugify(s.name),
    name: s.name,
    description: s.desc,
    tags: s.tags,
    featured: !!s.featured,
    premium: !!s.premium,
    sort_order: idx,
    status: 'published',
  }));

  const { data, error } = await supabase
    .from('souls')
    .upsert(rows, { onConflict: 'slug' })
    .select();

  if (error) {
    console.error('  ✗ Souls error:', error.message);
    process.exit(1);
  }
  console.log(`  ✓ ${data.length} souls upserted`);
}

async function seedSkills() {
  console.log('\n🛠️  Seeding skills...');
  let totalInserted = 0;
  let mdLoaded = 0;
  let sortGlobal = 0;

  for (const pillar of pillars) {
    const rows = pillar.skills.map((s) => {
      const slug = s.slugOverride || slugify(s.name);
      const md = loadMarkdownIfExists(slug);
      if (md) mdLoaded++;
      return {
        slug,
        name: s.name,
        description: s.desc,
        pillar: pillar.name,
        difficulty: s.difficulty,
        mastery_pollen_reward: s.pollen || 0,
        tags: s.tags || [],
        content_markdown: md,
        first_flight: !!s.firstFlight,
        mandatory: !!s.mandatory,
        premium: !!s.premium,
        featured: !!s.featured,
        sort_order: sortGlobal++,
        status: 'published',
      };
    });

    const { data, error } = await supabase
      .from('skills')
      .upsert(rows, { onConflict: 'slug' })
      .select();

    if (error) {
      console.error(`  ✗ ${pillar.name} error:`, error.message);
      process.exit(1);
    }
    console.log(`  ✓ ${pillar.name}: ${data.length} skills`);
    totalInserted += data.length;
  }

  console.log(`\n  Total skills upserted: ${totalInserted}`);
  console.log(`  SKILL.md files loaded into content_markdown: ${mdLoaded}`);
}

async function verify() {
  console.log('\n🔍 Verification:');
  const { count: soulCount } = await supabase.from('souls').select('*', { count: 'exact', head: true });
  const { count: skillCount } = await supabase.from('skills').select('*', { count: 'exact', head: true });
  const { count: mdCount } = await supabase.from('skills').select('*', { count: 'exact', head: true }).not('content_markdown', 'is', null);
  console.log(`  Souls in DB: ${soulCount}`);
  console.log(`  Skills in DB: ${skillCount}`);
  console.log(`  Skills with content_markdown: ${mdCount}`);
}

(async () => {
  await seedSouls();
  await seedSkills();
  await verify();
  console.log('\n✅ Migration complete.\n');
})();
