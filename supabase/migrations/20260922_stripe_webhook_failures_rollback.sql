-- Rollback: stripe_webhook_failures
-- Undoes: 20260922_stripe_webhook_failures.sql (sibling, same directory)
-- Ticket: NIK-TWO-DOORS-001
-- Date: September 22, 2026
-- Run in: Supabase SQL editor.
--
-- REVERT THE CODE FIRST, then run this. While the route holds the quarantine write the
-- table's absence is survivable — the write is best-effort and its failure is swallowed
-- and logged — so this rollback cannot take the webhook down the way dropping
-- stripe_events would. It still blinds the quarantine path completely: an unclassifiable
-- event is claimed, answered 200, emailed once, and after that there is nothing in the
-- database to find it by.
--
-- DESTRUCTIVE, and the loss is the point of the table. Every quarantined event that has
-- not been resolved by hand is lost with it. Export first, always:
--   SELECT id, event_id, event_type, reason, detail, created_at, resolved_at
--     FROM stripe_webhook_failures ORDER BY created_at;
-- Check for open rows before you run it — if this returns anything but 0, stop:
--   SELECT count(*) FROM stripe_webhook_failures WHERE resolved_at IS NULL;
--
-- No CASCADE: nothing should depend on this table, and if something has come to, the
-- DROP should fail loudly rather than take the dependent object with it. The indexes go
-- with the table and need no DROP INDEX of their own.

BEGIN;

DROP TABLE IF EXISTS stripe_webhook_failures;

COMMIT;

-- Nothing else to undo: the forward migration created no type, altered no existing
-- table, and added no column anywhere. stripe_events is a separate migration with its
-- own rollback and is untouched by this one.
