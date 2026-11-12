-- Rollback: bee_mail, and the two event values the mail lane writes
-- Undoes: 20261112_bee_mail.sql (sibling, same directory)
-- For: XI-1 v0.4 DESIGN BRIEF v1.1 §3, §7.19 · ANTENNA-006 item 8
-- Ticket: ANTENNA-006
-- Date: November 12, 2026
-- Run in: Supabase SQL editor.
--
-- Restores the bee_client_events CHECK FIRST, to the twelve values
-- 20261107_human_paired.sql left, then drops the table.
--
-- NOT SAFE IF mail_sent / mail_refused ROWS EXIST. Re-adding the narrower CHECK
-- fails if any row carries either value. That is the point: the rollback refuses
-- rather than orphaning rows the constraint would forbid. To roll back after bees
-- have mailed, delete those rows first (an audit of a lane that no longer exists):
--
--   DELETE FROM bee_client_events WHERE event IN ('mail_sent', 'mail_refused');
--
-- Dropping bee_mail discards its rows (shas, subjects, recipients). Export first
-- if they are wanted.
--
-- After this, /api/bee/mail and /api/bee/mail/send answer 503 on send (the row
-- cannot be written, so nothing is sent) and log a failed insert on read. Revert
-- the merge commit alongside this file.

ALTER TABLE bee_client_events DROP CONSTRAINT IF EXISTS bee_client_events_event_check;
ALTER TABLE bee_client_events
  ADD CONSTRAINT bee_client_events_event_check CHECK (event IN (
    'activate', 'revoke', 'awaken', 'heartbeat_flag', 'rate_limit',
    'runaway', 'auth_fail', 'credential_in_chamber', 'adoption_l1',
    'human_paired', 'unreachable', 'unsent_replies'));

DROP INDEX IF EXISTS bee_mail_one_per_provider_message;
DROP TABLE IF EXISTS bee_mail;
