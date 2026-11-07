-- Rollback: one human_paired row per bee (and the event value it needs)
-- Undoes: 20261107_human_paired.sql (sibling, same directory)
-- For: XI-1 ANTENNA DESIGN §6.12, §9 · ANTENNA-003 ruling 5
-- Ticket: ANTENNA-003
-- Date: November 7, 2026
-- Run in: Supabase SQL editor.
--
-- Drops the partial unique index, then narrows the event CHECK back to the twelve
-- values 20260913_antenna_v1.sql and 20260918 shipped — WITHOUT 'human_paired'.
--
-- NOT SAFE IF human_paired ROWS EXIST. Re-adding the narrower CHECK fails if any
-- bee_client_events row carries event = 'human_paired'. That is the point: the
-- rollback refuses rather than silently orphaning rows the constraint would forbid.
-- If you mean to roll back after bees have paired, delete those rows first (they are
-- an audit record of a state the colony no longer tracks):
--
--   DELETE FROM bee_client_events WHERE event = 'human_paired';
--
-- The RLS and GRANT statements in the forward file were re-assertions of the posture
-- the base migration already set, so there is nothing to undo there.
--
-- After this, /api/bee/heartbeat still treats a 23505 or an existing row as
-- "already recorded" and still returns 200; recording a pairing simply fails the
-- (now narrower) CHECK and is logged as a 'failed' outcome, exactly as any
-- unknown event value would be.

DROP INDEX IF EXISTS bee_client_events_one_pairing_per_agent;

ALTER TABLE bee_client_events DROP CONSTRAINT IF EXISTS bee_client_events_event_check;
ALTER TABLE bee_client_events
  ADD CONSTRAINT bee_client_events_event_check CHECK (event IN (
    'activate', 'revoke', 'awaken', 'heartbeat_flag', 'rate_limit',
    'runaway', 'auth_fail', 'credential_in_chamber', 'adoption_l1',
    'unreachable', 'unsent_replies'));
