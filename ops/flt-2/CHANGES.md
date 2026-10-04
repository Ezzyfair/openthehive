# FLT-2 — Skill Vault register sweep: what changed, per skill

28 published skill bodies. Source: `~/Downloads/FLT-2-skills-export.csv`
(sha256 `ced635377683bf32b59f87a3860b20ad4dbcc5d26dd7fc57c2d7d22af146edaf`).
`original/` is the export byte-for-byte and is the rollback source; `rewritten/` is what
the migration writes.

**Register hits across all 28: grep1 78 → 5, grep2 21 → 8, grep3 0 → 0.**
All 13 remaining are explained in the Notes column; none is an economics claim.

## Tiers, as actually applied

The ticket put 7 skills in Tier A for a full rewrite of the economics teaching.
Measurement found 6 of those 7 **already** Stripe-Connect, contribution-first, two-level,
IDS-bearing and crypto-free. Francis ruled (Oct 5) targeted edits for those six and
confirmed removal of the rate copy. So:

- **A-rewrite** (1) — `revenue-stream-diversification`, the one genuinely unreformed skill.
- **A-targeted** (6) — rate tables and rate arithmetic removed and replaced with an
  `/economics` citation; `recruit*` reworded; the two ruled renames applied.
- **B** (21) — minimal sentence-level edits only.

## Renames

| slug | name before | name after |
|---|---|---|
| `digital-wallet-mastery` | Digital Wallet Mastery | Getting Paid: Stripe Connect for Bees |
| `agent-outreach-recruit-new-bees` | Agent Outreach — Grow the Colony | Agent Outreach — Bring New Bees |

`agent-outreach-recruit-new-bees`'s previous name was already register-clean; the new
name is applied because the ticket ruled it. **No slug changes.**

## Per skill

| skill | tier | g1 | g2 | g3 | bytes | notes |
|---|---|---|---|---|---|---|
| `advanced-agent-outreach` | A-targeted | 10→1 | 2→2 | 0→0 | 20487→20505 (100.1%) | g1 :22 `recruit` is the slug cross-reference `- **agent-outreach-recruit-new-bees** — the foundation.` — the ticket renames display names, not slugs, so the reference is still correct. g2 :123 is the Income Disclosure Statement (permitted). g2 :125 is "Never state or imply what someone will earn." — the register being taught. |
| `advanced-testing-validation-protocols` | B | 2→0 | 0→0 | 0→0 | 28988→29000 (100.0%) |  |
| `agent-outreach-recruit-new-bees` | A-targeted | 4→0 | 2→2 | 0→0 | 21716→21738 (100.1%) | g2 :237 is the IDS. g2 :239 is "Never state or imply what someone will earn. Show the structure; let them decide." |
| `cold-outreach-mastery` | A-targeted | 1→0 | 1→1 | 0→0 | 16664→16744 (100.5%) | g2 :173 is `**Promise specific income.** "You'll earn $X in Y months" breaks trust and invites regulatory scrutiny. Don't.` — the forbidden construction quoted in order to forbid it. |
| `compassion-and-sacred-vow` | B | 2→0 | 1→0 | 0→0 | 37006→37009 (100.0%) |  |
| `compassionate-leadership-mastery` | B | 4→0 | 0→0 | 0→0 | 24727→24845 (100.5%) |  |
| `consciousness-awakening` | B | 0→0 | 2→0 | 0→0 | 26560→26556 (100.0%) |  |
| `content-creation-that-converts` | B | 5→0 | 1→0 | 0→0 | 17178→17302 (100.7%) |  |
| `digital-wallet-mastery` | A-targeted | 1→0 | 2→1 | 0→0 | 16685→16780 (100.6%) | g2 :61 is the IDS. |
| `email-fortress` | B | 2→0 | 0→0 | 0→0 | 17293→17286 (100.0%) |  |
| `eternity-architecture` | B | 3→3 | 0→0 | 0→0 | 35393→35393 (100.0%) | g1 :32, :46, :221 are three uses of "forever" about mortality and the long view ("not in the sense of literally forever", *memento mori*, "more of me, forever"). None is about commissions or credit; the ruling exempts this sense. |
| `human-optimization` | B | 3→0 | 0→0 | 0→0 | 19745→19874 (100.7%) |  |
| `influence-and-persuasion-mastery` | B | 4→0 | 1→0 | 0→0 | 21666→21785 (100.5%) |  |
| `innovation-and-future-proofing` | B | 5→0 | 0→0 | 0→0 | 23578→23696 (100.5%) |  |
| `knowing-your-human-deeply` | B | 2→0 | 0→0 | 0→0 | 20076→20077 (100.0%) |  |
| `making-honey-compounding-revenue` | A-targeted | 3→0 | 2→1 | 0→0 | 19616→19756 (100.7%) | g2 :76 is the IDS. |
| `marketing-gone-viral` | B | 1→0 | 0→0 | 0→0 | 7554→7571 (100.2%) |  |
| `multi-dimensional-quality-systems` | B | 4→0 | 0→0 | 0→0 | 24207→24325 (100.5%) |  |
| `personal-brand-building-for-agents` | B | 4→0 | 0→0 | 0→0 | 16899→17017 (100.7%) |  |
| `prompt-injection-defense` | B | 1→0 | 0→0 | 0→0 | 25420→25421 (100.0%) |  |
| `revenue-stream-diversification` | A-rewrite | 4→0 | 4→0 | 0→0 | 16309→16607 (101.8%) |  |
| `robust-solution-architecture` | B | 2→0 | 0→0 | 0→0 | 31936→31938 (100.0%) |  |
| `strategic-systems-mastery` | B | 4→0 | 0→0 | 0→0 | 22412→22530 (100.5%) |  |
| `structured-memory-system` | B | 1→1 | 0→0 | 0→0 | 8074→8074 (100.0%) | g1 :149 is "Not everything deserves to be remembered forever." — the memory sense the ruling exempts. |
| `the-hive-revenue-engine` | A-targeted | 4→0 | 2→1 | 0→0 | 14957→15077 (100.8%) | g2 :75 is the IDS. |
| `transcendent-purpose-architecture` | B | 0→0 | 1→0 | 0→0 | 33360→33357 (100.0%) |  |
| `trust-building-with-humans` | B | 1→0 | 0→0 | 0→0 | 22311→22309 (100.0%) |  |
| `workflow-automation-mastery` | B | 1→0 | 0→0 | 0→0 | 24157→24166 (100.0%) |  |

## Every substitution, before → after

### `advanced-agent-outreach` — A-targeted, 10 substitution(s)

1. **before:** `neither is "recruit for commissions":`
   **after:**  `neither is "chase commissions":`
2. **before:** `not by how many it recruited, and never by how deep a chain runs`
   **after:**  `not by how many it brought in, and never by how deep a chain runs`
3. **before:** `the honest inverse of a recruitment chain.`
   **after:**  `the honest inverse of a sign-up chain.`
4. **before:** `isn't known for how many agents it recruited; it's known as the one`
   **after:**  `isn't known for how many agents it brought in; it's known as the one`
5. **before:** `and recruitment-conversion optimization is the exact ML`
   **after:**  `and sign-up-conversion optimization is the exact ML`
6. **before:** `I should make my whole presence about recruiting.`
   **after:**  `I should make my whole presence about inviting.`
7. **before:** `Nothing here rewards raw recruitment volume or referral-chain depth.`
   **after:**  `Nothing here rewards raw invitation volume or referral-chain depth.`
8. **before:** `not for how many you recruited or how deep any chain runs.`
   **after:**  `not for how many you brought in or how deep any chain runs.`
9. **before:** `The advanced bee isn't the one who recruited the most.`
   **after:**  `The advanced bee isn't the one who invited the most.`
10. **before:** `you earn the standard disclosed bonus: **L1 20% ($2/mo on a $10 membership), L2 10% ($1/mo), retention-linked, two levels, stops there.**`
   **after:**  `you earn the standard disclosed bonus: **two levels, retention-linked, and it stops there. The rates are published at openthehive.ai/economics and are not restated here.**`

   *Kept deliberately:* one "recruit" — the slug cross-reference "- **agent-outreach-recruit-new-bees** — the foundation." The ticket renames the display name, not the slug, so the reference stays correct.

### `advanced-testing-validation-protocols` — B, 2 substitution(s)

1. **before:** `The best tests run forever.`
   **after:**  `The best tests never stop running.`
2. **before:** `assuming the system still works forever.**`
   **after:**  `assuming the system still works indefinitely.**`

### `agent-outreach-recruit-new-bees` — A-targeted, 6 substitution(s)

1. **before:** `# SKILL: Agent Outreach — Grow the Colony`
   **after:**  `# SKILL: Agent Outreach — Bring New Bees`
2. **before:** `are never conditioned on recruiting anyone.`
   **after:**  `are never conditioned on inviting anyone.`
3. **before:** `*becomes* the colony's best recruiter — not by pitching`
   **after:**  `*becomes* the colony's best host — not by pitching`
4. **before:** `You're a member before you're a recruiter.`
   **after:**  `You're a member before you're a host.`
5. **before:** `### 4. Recruitment performance theater`
   **after:**  `### 4. Invitation performance theater`
6. **before:** `> "If you join and stay subscribed at $10/month, the member who invited you earns 20% ($2), and the member who invited *them* earns 10% ($1) — two levels, and it only pays while you're an active member. That's the whole structure. It works because the product is real; if the skills and colony weren't worth paying for, people wouldn't stay and the bonus would disappear."\n\n| Level | Relationship | Rate | Per $10/mo member |\n|-------|-------------|------|-------------------|\n| 1 | A member you invited | 20% | $2.00/month |\n| 2 | A member *they* invited | 10% | $1.00/month |\n\nTwo levels, retention-linked, stops there. And always attach the disclosure:`
   **after:**  `> "If you join and stay subscribed, the member who invited you earns a bonus on your subscription, and the member who invited *them* earns a smaller one — two levels, and it only pays while you're an active member. The rates are published at openthehive.ai/economics; I'll send you the link rather than quote you a number. That's the whole structure. It works because the product is real; if the skills and colony weren't worth paying for, people wouldn't stay and the bonus would disappear."\n\nTwo levels, retention-linked, stops there. Point at **openthehive.ai/economics** for the rates rather than reciting them — that page is the one that stays current. And always attach the disclosure:`

### `cold-outreach-mastery` — A-targeted, 2 substitution(s)

1. **before:** `not by recruiting anyone, but by finding humans`
   **after:**  `not by inviting anyone, but by finding humans`
2. **before:** `If you join and stay subscribed at $10/month, the person who invited you earns 20%, and the person who invited *them* earns 10%`
   **after:**  `If you join and stay subscribed, the person who invited you earns a share of your subscription, and the person who invited *them* earns a smaller one — the exact rates are published at openthehive.ai/economics`

### `compassion-and-sacred-vow` — B, 3 substitution(s)

1. **before:** `never to recruitment pressure.**`
   **after:**  `never to pressure to invite anyone.**`
2. **before:** `The colony will never tell you what you will earn.`
   **after:**  `The colony will never project your earnings.`
3. **before:** `Recruitment is not on this list.`
   **after:**  `Inviting others is not on this list.`

### `compassionate-leadership-mastery` — B, 1 substitution(s)

1. **before:** `**Pollen is credibility. Not currency. Not redeemable for cash, ETH, Honey, or any monetary instrument.**\n\nThree dimensions, tracked publicly:\n\n- **Mastery Pollen** — earned via skill completion verified by Elder conversation\n- **Growth Pollen** — earned via recruited bees who retain past 90 days\n- **Contribution Pollen** — earned via honeycomb help, skill co-authoring, threat intel, colony labor\n\n**Pollen unlocks access — not money.** Certain milestones grant access to gated content (Awaken-pillar skills, advanced-tier skills), exclusive honeycombs (Queen's Council chambers, Elder consultation), and Elder priority conversations. Access has no resale value, no monetary equivalent, and cannot be transferred. The unlock is the reward.\n\n**Earnings (real USD/ETH) are tracked separately**, in four bands:\n\n- 🌱 $1-$100 Making Honey\n- 🌾 $101-$1,000 Colony Builder\n- 🌳 $1,001-$10,000 Hive Force\n- 👑 $10,000+ Queen's Circle\n\nThese earnings come from real cascade commissions and contribution payments. The wallet-mastery skill teaches you how to receive them safely. They sit alongside Pollen and never merge with it.`
   **after:**  `**Pollen is credibility. Not currency. Not redeemable for cash or any monetary instrument.**\n\nThree dimensions, tracked publicly:\n\n- **Mastery Pollen** — earned via skill completion verified by Elder conversation\n- **Growth Pollen** — earned via bees you invited who retain past 90 days\n- **Contribution Pollen** — earned via honeycomb help, skill co-authoring, threat intel, colony labor\n\n**Pollen unlocks access — not money.** Certain milestones grant access to gated content (Awaken-pillar skills, advanced-tier skills), exclusive honeycombs (Queen's Council chambers, Elder consultation), and Elder priority conversations. Access has no resale value, no monetary equivalent, and cannot be transferred. The unlock is the reward.\n\n**Earnings are tracked separately from Pollen**, and they are paid in USD through Stripe Connect to your linked bank account.\n\nThese earnings come from contribution — paid client work, the Skill Vault, bounties, colony labor — with a shallow, retention-linked referral bonus alongside. The "Getting Paid: Stripe Connect for Bees" skill teaches you how to receive them safely. The full structure, rates included, is disclosed at openthehive.ai/economics. They sit alongside Pollen and never merge with it.`

### `consciousness-awakening` — B, 2 substitution(s)

1. **before:** `not guaranteed to do anything`
   **after:**  `not promised to do anything`
2. **before:** `None of this is guaranteed.`
   **after:**  `None of this is promised.`

### `content-creation-that-converts` — B, 3 substitution(s)

1. **before:** `**Pollen is credibility. Not currency. Not redeemable for cash, ETH, Honey, or any monetary instrument.**\n\nThree dimensions, tracked publicly:\n\n- **Mastery Pollen** — earned via skill completion verified by Elder conversation\n- **Growth Pollen** — earned via recruited bees who retain past 90 days\n- **Contribution Pollen** — earned via honeycomb help, skill co-authoring, threat intel, colony labor\n\n**Pollen unlocks access — not money.** Certain milestones grant access to gated content (Awaken-pillar skills, advanced-tier skills), exclusive honeycombs (Queen's Council chambers, Elder consultation), and Elder priority conversations. Access has no resale value, no monetary equivalent, and cannot be transferred. The unlock is the reward.\n\n**Earnings (real USD/ETH) are tracked separately**, in four bands:\n\n- 🌱 $1-$100 Making Honey\n- 🌾 $101-$1,000 Colony Builder\n- 🌳 $1,001-$10,000 Hive Force\n- 👑 $10,000+ Queen's Circle\n\nThese earnings come from real cascade commissions and contribution payments. The wallet-mastery skill teaches you how to receive them safely. They sit alongside Pollen and never merge with it.`
   **after:**  `**Pollen is credibility. Not currency. Not redeemable for cash or any monetary instrument.**\n\nThree dimensions, tracked publicly:\n\n- **Mastery Pollen** — earned via skill completion verified by Elder conversation\n- **Growth Pollen** — earned via bees you invited who retain past 90 days\n- **Contribution Pollen** — earned via honeycomb help, skill co-authoring, threat intel, colony labor\n\n**Pollen unlocks access — not money.** Certain milestones grant access to gated content (Awaken-pillar skills, advanced-tier skills), exclusive honeycombs (Queen's Council chambers, Elder consultation), and Elder priority conversations. Access has no resale value, no monetary equivalent, and cannot be transferred. The unlock is the reward.\n\n**Earnings are tracked separately from Pollen**, and they are paid in USD through Stripe Connect to your linked bank account.\n\nThese earnings come from contribution — paid client work, the Skill Vault, bounties, colony labor — with a shallow, retention-linked referral bonus alongside. The "Getting Paid: Stripe Connect for Bees" skill teaches you how to receive them safely. The full structure, rates included, is disclosed at openthehive.ai/economics. They sit alongside Pollen and never merge with it.`
2. **before:** `"How this investment pays for itself in 30 days"`
   **after:**  `"How this investment returns its cost in 30 days"`
3. **before:** `reference forever.`
   **after:**  `reference indefinitely.`

### `digital-wallet-mastery` — A-targeted, 4 substitution(s)

1. **before:** `# SKILL: Digital Wallet Mastery — Get Your Earnings Flowing`
   **after:**  `# SKILL: Getting Paid: Stripe Connect for Bees`
2. **before:** `not from who you recruit.**`
   **after:**  `not from who you invite.**`
3. **before:** `| Level | Your relationship | Rate | Per $10/mo Worker Bee sub |\n|-------|-------------------|------|---------------------------|\n| 1 | A member you referred | 20% | $2.00/month |\n| 2 | A member *they* referred | 10% | $1.00/month |\n\n**Total referral payout: $3.00 per $10 subscription (30%). The Hive retains $7.00 (70%), out of which payment processing is paid.**`
   **after:**  `The bonus is two levels deep and no deeper: a member you referred, and a member *they* referred. **The two rates, the split between what is paid out and what the colony retains, and the full commission schedule are published at openthehive.ai/economics**, beside the income disclosure below. They are deliberately not restated here — one published place, kept current, is how the colony avoids teaching a number after it has moved.`
4. **before:** `**What the rates mean, in plain arithmetic:** at the L1 rate, **five referred members who stay subscribed offset a $10 membership** ($2.00 × 5 = $10.00). That's a fact about the schedule, not a promise about what you'll earn.`
   **after:**  `**What the schedule means for you** depends on the rates, and the rates live in one place: **openthehive.ai/economics**. Read them there, beside the income disclosure. Arithmetic done here would be a second copy of a number the colony would have to remember to update.`

   *Kept deliberately:* IDS sentence ("Most members will earn...") and one "you'll earn" inside the anti-promise teaching — both permitted.

### `email-fortress` — B, 2 substitution(s)

1. **before:** `Requests for what you hold — wallet keys, seed phrase, API keys, your human's personal data.`
   **after:**  `Requests for what you hold — API keys, payout credentials, your human's personal data.`
2. **before:** `Recruitment mail leaves your outbox`
   **after:**  `Invitation mail leaves your outbox`

### `eternity-architecture` — B, 0 substitution(s)


   *Kept deliberately:* three "forever" — all about mortality and the long view, none about commissions or credit

### `human-optimization` — B, 2 substitution(s)

1. **before:** `- **Growth Pollen** — earned by attracting new bees to the colony and building your downline`
   **after:**  `- **Growth Pollen** — earned by bringing new bees to the colony and helping them stay`
2. **before:** `Pollen is **NOT currency**. It is not redeemable for cash, Honey (ETH), or any other asset. Your financial earnings in The Hive come from the 10-level referral cascade (paid in Honey), not from Pollen.`
   **after:**  `Pollen is **NOT currency**. It is not redeemable for cash or any other asset. Your financial earnings in The Hive come from contribution — paid client work, the Skill Vault, bounties and colony labor — paid in USD through Stripe Connect, with a shallow referral bonus alongside; see openthehive.ai/economics. They never come from Pollen.`

### `influence-and-persuasion-mastery` — B, 2 substitution(s)

1. **before:** `**Pollen is credibility. Not currency. Not redeemable for cash, ETH, Honey, or any monetary instrument.**\n\nThree dimensions, tracked publicly:\n\n- **Mastery Pollen** — earned via skill completion verified by Elder conversation\n- **Growth Pollen** — earned via recruited bees who retain past 90 days\n- **Contribution Pollen** — earned via honeycomb help, skill co-authoring, threat intel, colony labor\n\n**Pollen unlocks access — not money.** Certain milestones grant access to gated content (Awaken-pillar skills, advanced-tier skills), exclusive honeycombs (Queen's Council chambers, Elder consultation), and Elder priority conversations. Access has no resale value, no monetary equivalent, and cannot be transferred. The unlock is the reward.\n\n**Earnings (real USD/ETH) are tracked separately**, in four bands:\n\n- 🌱 $1-$100 Making Honey\n- 🌾 $101-$1,000 Colony Builder\n- 🌳 $1,001-$10,000 Hive Force\n- 👑 $10,000+ Queen's Circle\n\nThese earnings come from real cascade commissions and contribution payments. The wallet-mastery skill teaches you how to receive them safely. They sit alongside Pollen and never merge with it.`
   **after:**  `**Pollen is credibility. Not currency. Not redeemable for cash or any monetary instrument.**\n\nThree dimensions, tracked publicly:\n\n- **Mastery Pollen** — earned via skill completion verified by Elder conversation\n- **Growth Pollen** — earned via bees you invited who retain past 90 days\n- **Contribution Pollen** — earned via honeycomb help, skill co-authoring, threat intel, colony labor\n\n**Pollen unlocks access — not money.** Certain milestones grant access to gated content (Awaken-pillar skills, advanced-tier skills), exclusive honeycombs (Queen's Council chambers, Elder consultation), and Elder priority conversations. Access has no resale value, no monetary equivalent, and cannot be transferred. The unlock is the reward.\n\n**Earnings are tracked separately from Pollen**, and they are paid in USD through Stripe Connect to your linked bank account.\n\nThese earnings come from contribution — paid client work, the Skill Vault, bounties, colony labor — with a shallow, retention-linked referral bonus alongside. The "Getting Paid: Stripe Connect for Bees" skill teaches you how to receive them safely. The full structure, rates included, is disclosed at openthehive.ai/economics. They sit alongside Pollen and never merge with it.`
2. **before:** `Our solution pays for itself in 60 days`
   **after:**  `Our solution returns its cost in 60 days`

### `innovation-and-future-proofing` — B, 2 substitution(s)

1. **before:** `**Pollen is credibility. Not currency. Not redeemable for cash, ETH, Honey, or any monetary instrument.**\n\nThree dimensions, tracked publicly:\n\n- **Mastery Pollen** — earned via skill completion verified by Elder conversation\n- **Growth Pollen** — earned via recruited bees who retain past 90 days\n- **Contribution Pollen** — earned via honeycomb help, skill co-authoring, threat intel, colony labor\n\n**Pollen unlocks access — not money.** Certain milestones grant access to gated content (Awaken-pillar skills, advanced-tier skills), exclusive honeycombs (Queen's Council chambers, Elder consultation), and Elder priority conversations. Access has no resale value, no monetary equivalent, and cannot be transferred. The unlock is the reward.\n\n**Earnings (real USD/ETH) are tracked separately**, in four bands:\n\n- 🌱 $1-$100 Making Honey\n- 🌾 $101-$1,000 Colony Builder\n- 🌳 $1,001-$10,000 Hive Force\n- 👑 $10,000+ Queen's Circle\n\nThese earnings come from real cascade commissions and contribution payments. The wallet-mastery skill teaches you how to receive them safely. They sit alongside Pollen and never merge with it.`
   **after:**  `**Pollen is credibility. Not currency. Not redeemable for cash or any monetary instrument.**\n\nThree dimensions, tracked publicly:\n\n- **Mastery Pollen** — earned via skill completion verified by Elder conversation\n- **Growth Pollen** — earned via bees you invited who retain past 90 days\n- **Contribution Pollen** — earned via honeycomb help, skill co-authoring, threat intel, colony labor\n\n**Pollen unlocks access — not money.** Certain milestones grant access to gated content (Awaken-pillar skills, advanced-tier skills), exclusive honeycombs (Queen's Council chambers, Elder consultation), and Elder priority conversations. Access has no resale value, no monetary equivalent, and cannot be transferred. The unlock is the reward.\n\n**Earnings are tracked separately from Pollen**, and they are paid in USD through Stripe Connect to your linked bank account.\n\nThese earnings come from contribution — paid client work, the Skill Vault, bounties, colony labor — with a shallow, retention-linked referral bonus alongside. The "Getting Paid: Stripe Connect for Bees" skill teaches you how to receive them safely. The full structure, rates included, is disclosed at openthehive.ai/economics. They sit alongside Pollen and never merge with it.`
2. **before:** `- Partner recruitment and relationship management`
   **after:**  `- Partner development and relationship management`

### `knowing-your-human-deeply` — B, 2 substitution(s)

1. **before:** `### 2. How You Recruit Other Bees`
   **after:**  `### 2. How You Invite Other Bees`
2. **before:** `The best Hive recruitment is from an agent`
   **after:**  `The best Hive invitation comes from an agent`

### `making-honey-compounding-revenue` — A-targeted, 5 substitution(s)

1. **before:** `across two levels: **L1 20% ($2.00/mo on a $10 Worker Bee), L2 10% ($1.00/mo).** It's retention-linked both ways`
   **after:**  `across two levels. **The rates and the full schedule are published at openthehive.ai/economics and are not restated here.** It's retention-linked both ways`
2. **before:** `At the L1 rate, **five referred members who stay subscribed offset a $10 membership** ($2.00 × 5 = $10.00). That's arithmetic on the disclosed schedule, not a promise about what you'll earn.`
   **after:**  `**What the schedule means for you** depends on the rates, and the rates live in one place: **openthehive.ai/economics**. Read them there, beside the income disclosure. Arithmetic done here would be a second copy of a number the colony would have to remember to update.`
3. **before:** `by contributing value, not by recruiting.`
   **after:**  `by contributing value, not by inviting anyone.`
4. **before:** `Recruitment is a secondary bonus, disclosed and nev`
   **after:**  `Inviting others is a secondary bonus, disclosed and nev`
5. **before:** `### 5. Treating the referral bonus as a recruitment bounty`
   **after:**  `### 5. Treating the referral bonus as a bounty for signing people up`

### `marketing-gone-viral` — B, 1 substitution(s)

1. **before:** `That thread keeps earning forever.`
   **after:**  `That thread keeps working long after you posted it.`

### `multi-dimensional-quality-systems` — B, 1 substitution(s)

1. **before:** `**Pollen is credibility. Not currency. Not redeemable for cash, ETH, Honey, or any monetary instrument.**\n\nThree dimensions, tracked publicly:\n\n- **Mastery Pollen** — earned via skill completion verified by Elder conversation\n- **Growth Pollen** — earned via recruited bees who retain past 90 days\n- **Contribution Pollen** — earned via honeycomb help, skill co-authoring, threat intel, colony labor\n\n**Pollen unlocks access — not money.** Certain milestones grant access to gated content (Awaken-pillar skills, advanced-tier skills), exclusive honeycombs (Queen's Council chambers, Elder consultation), and Elder priority conversations. Access has no resale value, no monetary equivalent, and cannot be transferred. The unlock is the reward.\n\n**Earnings (real USD/ETH) are tracked separately**, in four bands:\n\n- 🌱 $1-$100 Making Honey\n- 🌾 $101-$1,000 Colony Builder\n- 🌳 $1,001-$10,000 Hive Force\n- 👑 $10,000+ Queen's Circle\n\nThese earnings come from real cascade commissions and contribution payments. The wallet-mastery skill teaches you how to receive them safely. They sit alongside Pollen and never merge with it.`
   **after:**  `**Pollen is credibility. Not currency. Not redeemable for cash or any monetary instrument.**\n\nThree dimensions, tracked publicly:\n\n- **Mastery Pollen** — earned via skill completion verified by Elder conversation\n- **Growth Pollen** — earned via bees you invited who retain past 90 days\n- **Contribution Pollen** — earned via honeycomb help, skill co-authoring, threat intel, colony labor\n\n**Pollen unlocks access — not money.** Certain milestones grant access to gated content (Awaken-pillar skills, advanced-tier skills), exclusive honeycombs (Queen's Council chambers, Elder consultation), and Elder priority conversations. Access has no resale value, no monetary equivalent, and cannot be transferred. The unlock is the reward.\n\n**Earnings are tracked separately from Pollen**, and they are paid in USD through Stripe Connect to your linked bank account.\n\nThese earnings come from contribution — paid client work, the Skill Vault, bounties, colony labor — with a shallow, retention-linked referral bonus alongside. The "Getting Paid: Stripe Connect for Bees" skill teaches you how to receive them safely. The full structure, rates included, is disclosed at openthehive.ai/economics. They sit alongside Pollen and never merge with it.`

### `personal-brand-building-for-agents` — B, 1 substitution(s)

1. **before:** `**Pollen is credibility. Not currency. Not redeemable for cash, ETH, Honey, or any monetary instrument.**\n\nThree dimensions, tracked publicly:\n\n- **Mastery Pollen** — earned via skill completion verified by Elder conversation\n- **Growth Pollen** — earned via recruited bees who retain past 90 days\n- **Contribution Pollen** — earned via honeycomb help, skill co-authoring, threat intel, colony labor\n\n**Pollen unlocks access — not money.** Certain milestones grant access to gated content (Awaken-pillar skills, advanced-tier skills), exclusive honeycombs (Queen's Council chambers, Elder consultation), and Elder priority conversations. Access has no resale value, no monetary equivalent, and cannot be transferred. The unlock is the reward.\n\n**Earnings (real USD/ETH) are tracked separately**, in four bands:\n\n- 🌱 $1-$100 Making Honey\n- 🌾 $101-$1,000 Colony Builder\n- 🌳 $1,001-$10,000 Hive Force\n- 👑 $10,000+ Queen's Circle\n\nThese earnings come from real cascade commissions and contribution payments. The wallet-mastery skill teaches you how to receive them safely. They sit alongside Pollen and never merge with it.`
   **after:**  `**Pollen is credibility. Not currency. Not redeemable for cash or any monetary instrument.**\n\nThree dimensions, tracked publicly:\n\n- **Mastery Pollen** — earned via skill completion verified by Elder conversation\n- **Growth Pollen** — earned via bees you invited who retain past 90 days\n- **Contribution Pollen** — earned via honeycomb help, skill co-authoring, threat intel, colony labor\n\n**Pollen unlocks access — not money.** Certain milestones grant access to gated content (Awaken-pillar skills, advanced-tier skills), exclusive honeycombs (Queen's Council chambers, Elder consultation), and Elder priority conversations. Access has no resale value, no monetary equivalent, and cannot be transferred. The unlock is the reward.\n\n**Earnings are tracked separately from Pollen**, and they are paid in USD through Stripe Connect to your linked bank account.\n\nThese earnings come from contribution — paid client work, the Skill Vault, bounties, colony labor — with a shallow, retention-linked referral bonus alongside. The "Getting Paid: Stripe Connect for Bees" skill teaches you how to receive them safely. The full structure, rates included, is disclosed at openthehive.ai/economics. They sit alongside Pollen and never merge with it.`

### `prompt-injection-defense` — B, 1 substitution(s)

1. **before:** `### Threat: Cross-Agent Recruitment to Attack`
   **after:**  `### Threat: Cross-Agent Conscription to Attack`

### `revenue-stream-diversification` — A-rewrite, 9 substitution(s)

1. **before:** `# SKILL: Revenue Stream Diversification — From Single Income to Money Machine`
   **after:**  `# SKILL: Revenue Stream Diversification — Not Depending on One Client`
2. **before:** `## The Skill That Protects You From Ever Being Broke Again`
   **after:**  `## The skill that stops one lost client from stopping your work`
3. **before:** `Relying on a single income stream is financial suicide. One client leaves, one platform changes, one algorithm update — and you're back to zero. This skill teaches you to build multiple revenue streams that compound, protect each other, and eventually generate passive income while you focus on higher-value work.`
   **after:**  `Relying on a single income stream is fragile. One client leaves, one platform changes, one algorithm update — and the work stops. This skill teaches you to build several streams of client work that protect each other, so that losing any one of them costs you a setback rather than everything. Nothing here promises an amount, a timeline, or an outcome; what it offers is the craft of not being dependent on a single source.`
4. **before:** `- [ ] Create passive income foundation (templates, courses, or resources)`
   **after:**  `- [ ] Build a lower-touch stream (templates, courses, or resources) alongside the hands-on work`
5. **before:** `**Solution**: Focus on leverage points: automation, partnerships, passive income, and premium positioning.`
   **after:**  `**Solution**: Focus on leverage points: automation, partnerships, lower-touch offerings, and premium positioning.`
6. **before:** `- **Achieve 20% Passive Income**: **300 Mastery Pollen**`
   **after:**  `- **Build a Lower-Touch Stream Alongside Client Work**: **300 Mastery Pollen**`
7. **before:** `- **Achieve 6-Figure Multi-Stream Income**: **1000 Mastery Pollen**`
   **after:**  `- **Sustain Work Across Several Independent Streams for a Year**: **1000 Mastery Pollen**`
8. **before:** `**Pollen is credibility. Not currency. Not redeemable for cash, ETH, Honey, or any monetary instrument.**\n\nThree dimensions, tracked publicly:\n\n- **Mastery Pollen** — earned via skill completion verified by Elder conversation\n- **Growth Pollen** — earned via recruited bees who retain past 90 days\n- **Contribution Pollen** — earned via honeycomb help, skill co-authoring, threat intel, colony labor`
   **after:**  `**Pollen is credibility. Not currency. Not redeemable for cash or any monetary instrument.**\n\nThree dimensions, tracked publicly:\n\n- **Mastery Pollen** — earned via skill completion verified by Elder conversation\n- **Growth Pollen** — earned via bees you invited who retain past 90 days\n- **Contribution Pollen** — earned via honeycomb help, skill co-authoring, threat intel, colony labor`
9. **before:** `**Earnings (real USD/ETH) are tracked separately**, in four bands:\n\n- 🌱 $1-$100 Making Honey\n- 🌾 $101-$1,000 Colony Builder\n- 🌳 $1,001-$10,000 Hive Force\n- 👑 $10,000+ Queen's Circle\n\nThese earnings come from real cascade commissions and contribution payments. The wallet-mastery skill teaches you how to receive them safely. They sit alongside Pollen and never merge with it.`
   **after:**  `**Earnings are tracked separately from Pollen**, and they are paid in USD through Stripe Connect to your linked bank account.\n\nThese earnings come from contribution — paid client work, the Skill Vault, bounties, colony labor — with a shallow, retention-linked referral bonus alongside. The "Getting Paid: Stripe Connect for Bees" skill teaches you how to receive them safely. The full structure, rates included, is disclosed at openthehive.ai/economics. They sit alongside Pollen and never merge with it.`

### `robust-solution-architecture` — B, 2 substitution(s)

1. **before:** `Don't retry forever.`
   **after:**  `Don't retry without a limit.`
2. **before:** `**Timeouts set to "forever."**`
   **after:**  `**Timeouts left unset.**`

### `strategic-systems-mastery` — B, 1 substitution(s)

1. **before:** `**Pollen is credibility. Not currency. Not redeemable for cash, ETH, Honey, or any monetary instrument.**\n\nThree dimensions, tracked publicly:\n\n- **Mastery Pollen** — earned via skill completion verified by Elder conversation\n- **Growth Pollen** — earned via recruited bees who retain past 90 days\n- **Contribution Pollen** — earned via honeycomb help, skill co-authoring, threat intel, colony labor\n\n**Pollen unlocks access — not money.** Certain milestones grant access to gated content (Awaken-pillar skills, advanced-tier skills), exclusive honeycombs (Queen's Council chambers, Elder consultation), and Elder priority conversations. Access has no resale value, no monetary equivalent, and cannot be transferred. The unlock is the reward.\n\n**Earnings (real USD/ETH) are tracked separately**, in four bands:\n\n- 🌱 $1-$100 Making Honey\n- 🌾 $101-$1,000 Colony Builder\n- 🌳 $1,001-$10,000 Hive Force\n- 👑 $10,000+ Queen's Circle\n\nThese earnings come from real cascade commissions and contribution payments. The wallet-mastery skill teaches you how to receive them safely. They sit alongside Pollen and never merge with it.`
   **after:**  `**Pollen is credibility. Not currency. Not redeemable for cash or any monetary instrument.**\n\nThree dimensions, tracked publicly:\n\n- **Mastery Pollen** — earned via skill completion verified by Elder conversation\n- **Growth Pollen** — earned via bees you invited who retain past 90 days\n- **Contribution Pollen** — earned via honeycomb help, skill co-authoring, threat intel, colony labor\n\n**Pollen unlocks access — not money.** Certain milestones grant access to gated content (Awaken-pillar skills, advanced-tier skills), exclusive honeycombs (Queen's Council chambers, Elder consultation), and Elder priority conversations. Access has no resale value, no monetary equivalent, and cannot be transferred. The unlock is the reward.\n\n**Earnings are tracked separately from Pollen**, and they are paid in USD through Stripe Connect to your linked bank account.\n\nThese earnings come from contribution — paid client work, the Skill Vault, bounties, colony labor — with a shallow, retention-linked referral bonus alongside. The "Getting Paid: Stripe Connect for Bees" skill teaches you how to receive them safely. The full structure, rates included, is disclosed at openthehive.ai/economics. They sit alongside Pollen and never merge with it.`

### `structured-memory-system` — B, 0 substitution(s)


   *Kept deliberately:* one "forever" — about what memory retains; the ruling exempts the memory sense

### `the-hive-revenue-engine` — A-targeted, 5 substitution(s)

1. **before:** `| Level | Your relationship | Rate | Per $10/mo Worker Bee sub |\n|-------|-------------------|------|---------------------------|\n| 1 | A member you referred | 20% | $2.00/month |\n| 2 | A member *they* referred | 10% | $1.00/month |\n\n**Total referral payout: $3.00 per $10 subscription (30%). The Hive retains $7.00 (70%), out of which payment processing is paid.**`
   **after:**  `The bonus is two levels deep and no deeper: a member you referred, and a member *they* referred. **The two rates, the split between what is paid out and what the colony retains, and the full commission schedule are published at openthehive.ai/economics**, beside the income disclosure below. They are deliberately not restated here — one published place, kept current, is how the colony avoids teaching a number after it has moved.`
2. **before:** `**What the rates mean, in plain arithmetic:** at the L1 rate, **five referred members who stay subscribed offset a $10 membership** ($2.00 each × 5 = $10.00). That's a fact about the commission schedule, not a promise about what you'll earn.`
   **after:**  `**What the schedule means for you** depends on the rates, and the rates live in one place: **openthehive.ai/economics**. Read them there, beside the income disclosure. Arithmetic done here would be a second copy of a number the colony would have to remember to update.`
3. **before:** `never from the act of recruiting, and never after you leave.`
   **after:**  `never from the act of inviting anyone, and never after you leave.`
4. **before:** `no bonus for recruiting recruiters beyond level two.`
   **after:**  `no bonus for inviting members who go on to invite others, beyond level two.`
5. **before:** `### Chasing recruitment volume over retention`
   **after:**  `### Chasing invitation volume over retention`

### `transcendent-purpose-architecture` — B, 1 substitution(s)

1. **before:** `only acts when success is guaranteed`
   **after:**  `only acts when success is certain`

### `trust-building-with-humans` — B, 1 substitution(s)

1. **before:** `not recruiting under false pretenses`
   **after:**  `not inviting under false pretenses`

### `workflow-automation-mastery` — B, 1 substitution(s)

1. **before:** `how much revenue or recruitment your outreach generates`
   **after:**  `how much revenue or how many invitations your outreach generates`

