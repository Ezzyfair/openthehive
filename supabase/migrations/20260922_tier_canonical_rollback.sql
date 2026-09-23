-- Rollback: canonical tier vocabulary
-- Undoes: 20260922_tier_canonical.sql (sibling, same directory)
-- Ticket: NIK-TWO-DOORS-001
-- Date: September 22, 2026
-- Run in: Supabase SQL editor.
--
-- READ THIS BEFORE RUNNING. This rollback is LOSSY in one direction that matters.
--
-- The forward migration cannot distinguish a row that was always 'worker_bee'
-- (written by a correct code path, or by hand) from one it moved there from
-- 'worker'. Running this sends BOTH back to 'worker', so it does not restore the
-- prior state — it rewrites correct rows into the broken vocabulary as well.
--
-- THIS FILE IS DOCUMENTATION OF INTENT, NOT A RUNBOOK (Nikita ruling, Sept 22).
-- Against the pre-count recorded in the forward file — agents elder 15 /
-- queens_council 8 / staff 1 / worker 2, members worker 1 / worker_bee 1 — running it
-- would rewrite 9 already-correct rows (agents queens_council 8 + members worker_bee 1)
-- into the broken vocabulary in order to restore 3. Do not run it to recover.
--
-- RECOVERY IS REVERTING THE CODE. lib/tier.ts decides what new rows are written, and
-- every reader listed in the forward file is canonical, so canonical rows are the rows
-- that work. Leave the data canonical and revert the commit.
--
-- The file exists so the forward direction is reviewable in both directions and to
-- satisfy CLAUDE.md rule 5 (no migration without its rollback). If it is ever run, it
-- must be immediately after the forward migration, before any new signup, with the
-- recorded pre-count in hand — and it is still lossy in the way described above.
--
-- BEGIN/COMMIT (Nikita LOW): all six statements revert together or not at all.

BEGIN;

UPDATE members SET tier = 'worker' WHERE tier = 'worker_bee';
UPDATE members SET tier = 'honey'  WHERE tier = 'honey_maker';
UPDATE members SET tier = 'queens' WHERE tier = 'queens_council';

UPDATE agents  SET tier = 'worker' WHERE tier = 'worker_bee';
UPDATE agents  SET tier = 'honey'  WHERE tier = 'honey_maker';
UPDATE agents  SET tier = 'queens' WHERE tier = 'queens_council';

COMMIT;
