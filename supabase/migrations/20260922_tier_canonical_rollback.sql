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
-- Only run it if the forward migration is being reverted immediately, before any
-- new signup, and only with the pre-count output in hand to compare against. If
-- time has passed, prefer leaving the canonical values in place and reverting the
-- CODE instead: lib/tier.ts is what decides what new rows get, and the readers
-- listed in the forward file are all canonical, so canonical rows are the ones that
-- work.

UPDATE members SET tier = 'worker' WHERE tier = 'worker_bee';
UPDATE members SET tier = 'honey'  WHERE tier = 'honey_maker';
UPDATE members SET tier = 'queens' WHERE tier = 'queens_council';

UPDATE agents  SET tier = 'worker' WHERE tier = 'worker_bee';
UPDATE agents  SET tier = 'honey'  WHERE tier = 'honey_maker';
UPDATE agents  SET tier = 'queens' WHERE tier = 'queens_council';
