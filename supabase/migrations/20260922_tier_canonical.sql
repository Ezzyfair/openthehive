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
-- PRE-COUNT — RUN THIS FIRST AND KEEP THE OUTPUT. I could not run it myself: this
-- repo has no .env and the service-role key lives in Vercel (CLAUDE.md rule 2), so
-- the numbers below are yours to record, not mine to predict.
--
--   SELECT 'members' AS tbl, tier, count(*) FROM members GROUP BY tier
--   UNION ALL
--   SELECT 'agents'  AS tbl, tier, count(*) FROM agents  GROUP BY tier
--   ORDER BY tbl, tier;
--
-- Expected shape, not counts: rows at 'worker' / 'honey' / 'queens' are the ones
-- this migration moves. 'scout' rows are written by
-- app/api/agents/register/route.ts:269 and :400 and are already canonical — they
-- must NOT change, and the row counts for 'scout' should be identical afterwards.
-- Any tier value not in the seven words named in this file is a surprise: stop and
-- report it rather than running the UPDATEs.
--
-- NO CHECK CONSTRAINT OR ENUM WAS FOUND on either column. The two repo migrations
-- (20260426, 20260427) never create or alter members.tier or agents.tier — both
-- tables predate supabase/migrations and live in the SQL editor — so these UPDATEs
-- cannot be rejected by a constraint, and equally nothing prevents a
-- non-canonical value being written again. Adding a CHECK is the durable fix and is
-- deliberately NOT in this file: it would fail while any legacy row remains, so it
-- belongs in a follow-up once these counts are zero.

-- members
UPDATE members SET tier = 'worker_bee'     WHERE tier = 'worker';
UPDATE members SET tier = 'honey_maker'    WHERE tier = 'honey';
UPDATE members SET tier = 'queens_council' WHERE tier = 'queens';

-- agents
UPDATE agents  SET tier = 'worker_bee'     WHERE tier = 'worker';
UPDATE agents  SET tier = 'honey_maker'    WHERE tier = 'honey';
UPDATE agents  SET tier = 'queens_council' WHERE tier = 'queens';

-- POST-COUNT — re-run the pre-count query. 'worker', 'honey' and 'queens' should be
-- absent from both tables, 'scout' unchanged, and the paid totals should equal the
-- pre-count paid totals moved across.
