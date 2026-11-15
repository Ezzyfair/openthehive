-- Rollback: wingmate_pairs, the five room functions, and the two event values the room lane writes
-- Undoes: 20261114_rooms.sql (sibling, same directory)
-- For: XI-1 v0.4 DESIGN BRIEF v1.1 §4, §7.15, §7.19 · ANTENNA-007 item 2
-- Ticket: ANTENNA-007
-- Date: November 14, 2026
-- Run in: Supabase SQL editor.
--
-- Restores the bee_client_events CHECK FIRST, to the fourteen values
-- 20261112_bee_mail.sql left, then drops the five functions, the two indexes and
-- the table.
--
-- NOT SAFE IF room_post / room_choice ROWS EXIST. Re-adding the narrower CHECK
-- fails if any row carries either value. That is the point: the rollback refuses
-- rather than orphaning rows the constraint would forbid. To roll back after bees
-- have posted or chosen, delete those rows first (an audit of a lane that no longer
-- exists):
--
--   DELETE FROM bee_client_events WHERE event IN ('room_post', 'room_choice');
--
-- Dropping wingmate_pairs discards its rows. Export first if they are wanted.
--
-- NOT UNDONE HERE: honeycombs rows of type 'wingmate' or 'swarm' that the functions
-- created, their honeycomb_members rows, and messages posted in them. They are data
-- in tables this migration did not create; whether to archive or delete them is a
-- ruling, not a rollback step.
--
-- After this, /api/bee/rooms still answers (the derived list simply finds no pairs
-- to name), and /api/bee/rooms/<id>/post writes its message but logs a failed
-- room_post event, so the daily count would stop counting. Revert the merge commit
-- alongside this file.

ALTER TABLE bee_client_events DROP CONSTRAINT IF EXISTS bee_client_events_event_check;
ALTER TABLE bee_client_events
  ADD CONSTRAINT bee_client_events_event_check CHECK (event IN (
    'activate', 'revoke', 'awaken', 'heartbeat_flag', 'rate_limit',
    'runaway', 'auth_fail', 'credential_in_chamber', 'adoption_l1',
    'human_paired', 'unreachable', 'unsent_replies',
    'mail_sent', 'mail_refused'));

DROP FUNCTION IF EXISTS swarm_close(uuid);
DROP FUNCTION IF EXISTS swarm_open(uuid, text, uuid[], uuid);
DROP FUNCTION IF EXISTS wingmate_release(uuid, text);
DROP FUNCTION IF EXISTS wingmate_fill(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS wingmate_open(uuid, uuid, boolean, uuid);

DROP INDEX IF EXISTS wingmate_pairs_one_open_agent_b;
DROP INDEX IF EXISTS wingmate_pairs_one_open_agent_a;
DROP TABLE IF EXISTS wingmate_pairs;
