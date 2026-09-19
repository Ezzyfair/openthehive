-- Rollback: one adoption_l1 row per bee
-- Undoes: 20260918_antenna_adoption_unique.sql (sibling, same directory)
-- For: XI-1 ANTENNA DESIGN v0.2.2 §10.2 · NIK-ANTENNA-005c FIND-ADOPT-1
-- Ticket: NIK-ANTENNA-006
-- Date: September 18, 2026
-- Run in: Supabase SQL editor.
--
-- Non-destructive: drops an index, touches no row and changes no grant. The RLS
-- and GRANT statements in the forward file were re-assertions of the posture
-- 20260913_antenna_v1.sql already set, so there is nothing to undo there — undoing
-- them would REMOVE protection the table is supposed to have.
--
-- After this, /api/bee/heartbeat still treats 23505 as "already recorded", so it
-- keeps working; the duplicate it used to prevent simply becomes possible again
-- when two heartbeats race.

DROP INDEX IF EXISTS bee_client_events_one_adoption_per_agent;
