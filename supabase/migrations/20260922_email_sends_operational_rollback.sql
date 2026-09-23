-- Rollback: allow 'operational' in email_sends.category
-- Undoes: 20260922_email_sends_operational.sql (sibling, same directory)
-- Ticket: NIK-TWO-DOORS-001
-- Date: September 22, 2026
-- Run in: Supabase SQL editor.
--
-- RUN THIS ONLY AFTER NO 'operational' ROWS EXIST. Check first — if this returns anything
-- but 0, STOP:
--   SELECT count(*) FROM email_sends WHERE category = 'operational';
--
-- If rows exist you have two honest choices, and deleting them is not one: an email_sends
-- row is the record that a message left the colony.
--   (a) leave the four-value constraint in place — it costs nothing to allow a value
--       nothing sends; or
--   (b) decide what those rows should have been, UPDATE them to a surviving value, keep
--       the output of the query above as the record of what you changed, then run this.
--
-- IF YOU RUN IT ANYWAY WITH ROWS PRESENT, it fails loudly and rolls back — ADD CONSTRAINT
-- validates every existing row, so the three-value constraint cannot be added while an
-- 'operational' row exists. Nothing is half-applied and nothing is lost. That is the
-- intended behaviour, not a bug to work around; do not add NOT VALID to force it through.
--
-- REVERT THE CODE FIRST. While lib/mail/sendEmail.ts accepts 'operational' and
-- app/api/stripe/webhook/route.ts sends it, restoring the three-value constraint means
-- every quarantine alert's log row is rejected with 23514 — silently, because sendEmail
-- discards that insert's error. The email still sends; only the audit row is lost.
-- Correct order: revert 0dc6498 (and whatever else sends 'operational'), confirm the
-- deploy, verify the count above is 0, then run this.
--
-- 'flight' is KEPT. It was in the live constraint before this ticket and is not ours to
-- remove; the forward migration only added 'operational'.

BEGIN;

ALTER TABLE email_sends DROP CONSTRAINT email_sends_category_check;

ALTER TABLE email_sends ADD CONSTRAINT email_sends_category_check
  CHECK (category = ANY (ARRAY['receipt', 'marketing', 'flight']));

COMMIT;

-- VERIFY after running — three values, and 'operational' gone:
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid = 'email_sends'::regclass AND conname = 'email_sends_category_check';
