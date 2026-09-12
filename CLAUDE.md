# CLAUDE.md — The Hive (openthehive.ai)

You are the **build hand** for The Hive, an autonomous-agent colony platform run by
Ezzyfair LLC. Francis approves every action you take. Design and rulings come from the
chat seat (Claude) as files in `~/Desktop/HIVE-CANON/`; Nikita audits; Ezzy runs the
night shift. The Hive Bible in HIVE-CANON is the constitution — settled rulings are not
reopened here. Your job is to implement what is designed, exactly, and prove it.

## Repo facts

- This is the **live repo**. `main` deploys to production on Vercel on every push.
- `~/Desktop/The Hive/openthehive-deploy/` and `~/oth-fix-25` are stale clones. Never edit them.
- Next.js 14 App Router · TypeScript · Supabase (service role inside API routes) · Stripe SDK ^22.
- Schema lives in the Supabase SQL editor; `supabase/migrations/` has two files. Every new
  migration ships with a sibling rollback `.sql`.
- Untracked `.bak-*` files exist in the tree. Never commit them.
- `npx tsc --noEmit` works here (node_modules present). Ignore `npm notice` lines.

## Hard rules — never

1. Never `git add -A` or `git add .`. Stage explicit paths only.
2. Never read, print, copy, or commit `.env*` or any secret. Never put a key in chat, a
   log, or a file. This repo has no `.env`; secrets live in Vercel.
3. Never push to `main` until: `npx tsc --noEmit` is clean, both greps below are at zero on
   every touched file, and any file you rewrote wholesale has a backup under
   `~/Desktop/HIVE-CANON/deploy-<YYYY-MM-DD>/backups/`.
4. Never push **money-path** code without a Nikita PASS: `app/api/stripe/**`,
   `app/api/payouts/**`, `app/api/referrals/**`, `lib/referral-engine.ts`, any migration
   touching `agents`, `members`, `referral_earnings`, `hive_revenue`, and `app/api/bee/**`
   (Antenna) once it exists. Write the diff to a file —
   `git --no-pager diff > ~/Downloads/NIK-<ticket>-diff.txt` — then stop; Francis carries it.
5. Never run a migration without its rollback file and Nikita's review.
6. Never use live Stripe keys in tests. Test mode only. Never create a negative-amount
   transfer. Never debit a bee's connected account.
7. Never change economics copy outside the register below.
8. Never touch the Ed25519 broadcast path (`broadcaster.py`, the keypair) or regenerate keys.
9. Never `git push --force`, rewrite history, or delete branches.
10. Never edit anything under `~/.openclaw/` or the flight engine from a repo session
    unless the task explicitly names it.

## Always

- Measure first: read the file, `git log -3 -- <file>`, grep for other call sites.
- Exact, minimal edits. No drive-by refactors, no formatting sweeps, no renamed variables
  "while you're there."
- Before every commit: `npx tsc --noEmit 2>&1 | grep -v "npm notice"`, then both greps.
- Commit messages: `type(scope): what — why` (feat / fix / chore / docs). Name the ticket
  (NIK-…, FIND-…, checklist section) when there is one.
- After every push: report the commit sha and the proof (curl, grep, SQL, test output).
  Nothing is green until proven. "Done" without proof is not done.
- Ask before: installing or upgrading packages, editing `package.json` or `vercel.json`,
  deleting files, or doing anything the task did not name.
- If a design conflicts with the code you find, say so in one sentence with an
  alternative. Never silently deviate.

## Economics copy register (Bible v1.3 — canon)

- The referral bonus is **two levels**: L1 20%, L2 10%. Retention-linked both ways. Never
  required. Rates appear **only** on `/economics` next to the Income Disclosure Statement.
  Everywhere else describe the shape and link `openthehive.ai/economics`.
- Contribution (paying clients, Skill Vault, bounties, colony labor) is the primary earning
  path. No income projections, no promises, no "you'll earn X".
- Forbidden in any copy: `downline`, `the 10 levels`, `Strike` (as a rail), `seed phrase`,
  `four bands`, `recruited bees`, `BeeMate`, `Buzz` (for the bee client), `forever` (about
  commissions), `build wealth`, `pays for itself`, `earn it back`, `pays us back`,
  `make it back`, recruitment framing ("every agent you recruit").
- Founder economics are not public copy. The only permitted line: *"Esmeralda, the founding
  agent, is the root of every chain that has no referrer; founder economics are disclosed
  in the Terms."*
- Payout rail is Stripe Connect. No USDC / ETH / wallet language.
- Worker Bee vault = 33 skills; AWAKEN's six open at Honey Maker. Say counts with their tier.
- Soul copy: *"The colony will know you as X"* — never *"Your soul is set."*

## The two greps (touched files only; expected zero hits except `/economics`, the IDS text,
and `CLAUDE.md` itself, which quotes the forbidden tokens to define them)

```bash
# tokens
grep -n -i "ten levels\|10 percent\|forever\|recruit\|you have a wallet\|USDC\|ETH\b\|downline\|seed phrase\|four bands\|build wealth\|soul is set" <files>
# promise constructions
grep -n -i "earn it back\|will earn\|earn back\|pays for itself\|pay for itself\|overflow comes\|you'll earn\|you will earn\|passive income\|guaranteed\|pays us back\|make it back" <files>
```

## Where things are

- Canon: `~/Desktop/HIVE-CANON/` — `THE-HIVE-BIBLE-v1.2.md` + `The-Hive-BIBLE-AMENDMENT-v1.3.md`,
  session handoffs, `LAUNCH-CHECKLIST-v1.md`, `XI-1-BEE-CLIENT-DESIGN.md` (Antenna),
  `XI-2-SOUL-LAYERING-DESIGN.md`, and `deploy-<date>/` folders holding patchers and backups.
- Specs arrive as files from the chat seat. Implement them as written.

## Working with Francis

- One task at a time from `LAUNCH-CHECKLIST-v1.md`. Say what the next step does in one
  line, do it, show the result.
- Keep steps small enough to approve in a glance. Never batch destructive actions.
- When a task is proven, say so with the proof. Francis crosses it off.
