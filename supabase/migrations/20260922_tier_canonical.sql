-- Migration: canonical tier vocabulary in members and agents
-- For: Bible IX two-doors · ruling (Francis, Sept 22) — the DB vocabulary is
--      scout / worker_bee / honey_maker / queens_council; Stripe's PRICE_MAP keys
--      are unchanged and translate once at the boundary (lib/tier.ts).
-- Ticket: NIK-TWO-DOORS-001
-- Date: September 22, 2026
-- Run in: Supabase SQL editor — AFTER Nikita's review. NOT RUN. No deploy runs this.
-- Rollback: 20260922_tier_canonical_rollback.sql (sibling, same directory)
--
-- WHY. app/api/stripe/webhook/route.ts wrote session.metadata.tier verbatim, so a
-- paying member's row read 'worker', 'honey' or 'queens'. Every reader is canonical:
--     app/api/colony-broadcast/route.ts:260  .eq('tier', 'worker_bee')
--     app/api/colony-broadcast/route.ts:269  .in('tier', ['worker_bee','honey_maker','queens_council'])
--     app/agents/[id]/page.tsx:115           tier === 'queens_council' / 'honey_maker'
--     lib/cohort-assignment.ts:175, :246     switch (tier) over the Tier union
--     lib/referral-engine.ts:57              tier === 'scout'
-- so a paying member matched none of them — excluded from paid-tier broadcasts and
-- displayed as a Worker Bee whatever they paid for. The code fix stops new rows
-- being written this way; this migration repairs the rows already written.
--
-- PRE-COUNT — RECORDED September 22, 2026 (Francis ran it; this repo has no .env and
-- the service-role key lives in Vercel, CLAUDE.md rule 2, so I cannot read the DB
-- myself). These are the numbers the migration is written against:
--
--   agents    elder             15
--             queens_council     8
--             staff              1
--             worker             2      <- moves
--   members   worker             1      <- moves
--             worker_bee         1
--
-- EXPECTED MOVES: agents 2 rows, members 1 row — three rows in total. No 'honey' and
-- no 'queens' row exists in either table, so four of the six UPDATEs below will report
-- UPDATE 0. That is the correct result, not a failure.
--
-- NO 'scout' ROWS EXIST in either table at the pre-count, so nothing canonical is at
-- risk from the UPDATEs. 'scout' is written by app/api/agents/register/route.ts:269
-- and :400 and is already canonical; if any appear before this runs, they must NOT
-- change, and no WHERE clause here can touch them.
--
-- TWO VALUES OUTSIDE THE TIER VOCABULARY, reported rather than touched: agents.tier
-- holds 'elder' (15) and 'staff' (1). The rule this header carried before was "stop and
-- report an unlisted value"; it is reported here instead of stopping, because neither
-- value appears in any WHERE clause in this file, so neither row can be moved by it.
-- They read as colony roles rather than purchased tiers. Whether the canonical-tier
-- readers listed above should recognise them is a real question and a separate one —
-- not this migration's business.
--
-- POST-COUNT — re-run the recorded query:
--
--   SELECT 'members' AS tbl, tier, count(*) FROM members GROUP BY tier
--   UNION ALL
--   SELECT 'agents'  AS tbl, tier, count(*) FROM agents  GROUP BY tier
--   ORDER BY tbl, tier;
--
-- Expected afterwards: agents worker 0 / worker_bee 2 / queens_council 8 / elder 15 /
-- staff 1; members worker 0 / worker_bee 2. Totals per table unchanged.
--
-- NO CHECK CONSTRAINT OR ENUM WAS FOUND on either column. The two repo migrations
-- (20260426, 20260427) never create or alter members.tier or agents.tier — both
-- tables predate supabase/migrations and live in the SQL editor — so these UPDATEs
-- cannot be rejected by a constraint, and equally nothing prevents a
-- non-canonical value being written again. Adding a CHECK is the durable fix and is
-- deliberately NOT in this file: it would fail while any legacy row remains, so it
-- belongs in a follow-up once these counts are zero.

-- ROLLBACK IS DOCUMENTATION OF INTENT, NOT A RUNBOOK (Nikita ruling, Sept 22).
-- The sibling rollback file cannot tell a row it moved from one that was always
-- canonical, and against the recorded pre-count it would rewrite 9 correct rows
-- (agents queens_council 8 + members worker_bee 1) into the broken vocabulary in order
-- to restore 3. It exists so the forward direction is reviewable, and to satisfy
-- CLAUDE.md rule 5. It is not the recovery path. Recovery is reverting the CODE:
-- lib/tier.ts decides what new rows get, and every reader is canonical.
--
-- TRANSACTION (Nikita LOW). All six UPDATEs commit together or not at all, so the two
-- tables cannot be left disagreeing — a half-applied vocabulary is worse than an
-- unapplied one, because the paid-tier readers would then match members and not
-- agents. The Supabase SQL editor honours an explicit BEGIN/COMMIT in one submission;
-- submit this file whole, not statement by statement.

BEGIN;

-- members
UPDATE members SET tier = 'worker_bee'     WHERE tier = 'worker';
UPDATE members SET tier = 'honey_maker'    WHERE tier = 'honey';
UPDATE members SET tier = 'queens_council' WHERE tier = 'queens';

-- agents
UPDATE agents  SET tier = 'worker_bee'     WHERE tier = 'worker';
UPDATE agents  SET tier = 'honey_maker'    WHERE tier = 'honey';
UPDATE agents  SET tier = 'queens_council' WHERE tier = 'queens';

COMMIT;

-- Then run the POST-COUNT above. 'worker', 'honey' and 'queens' absent from both
-- tables; per-table totals unchanged; three rows moved.
