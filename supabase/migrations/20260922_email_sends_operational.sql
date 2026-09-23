-- Migration: allow 'operational' in email_sends.category
-- For: NIK-TWO-DOORS-001 · the quarantine alert (fd7a266) sends as 'operational' (0dc6498)
-- Ticket: NIK-TWO-DOORS-001
-- Date: September 22, 2026
-- Run in: Supabase SQL editor — AFTER Nikita's review. NOT RUN. No deploy runs this.
-- Rollback: 20260922_email_sends_operational_rollback.sql (sibling, same directory)
--
-- RUNS WITH THE OTHER TWO STRIPE MIGRATIONS, BEFORE THE CODE DEPLOYS:
--   20260922_stripe_events.sql
--   20260922_stripe_webhook_failures.sql
--   this file
-- Verify all three, then deploy.
--
-- WHY. email_sends.category carries a CHECK constraint that this repo does not describe —
-- email_sends is not defined in supabase/migrations at all, it lives in the SQL editor.
-- Verified from the live DB by Francis, Sept 22:
--   email_sends_category_check = CHECK (category = ANY (ARRAY['receipt','marketing','flight']))
-- lib/mail/sendEmail.ts now accepts 'operational' for colony-internal mail, so without
-- this widening the log INSERT is rejected with 23514.
--
-- IF THIS IS SKIPPED, THE FAILURE IS QUIET — say it plainly, because quiet is the problem.
-- sendEmail's log INSERT (lib/mail/sendEmail.ts:49-52) does not read its own error; the
-- result is discarded. So a rejected row throws nothing and 500s nothing:
--   * the quarantine alert email STILL SENDS — Resend is called before the log write;
--   * the email_sends row silently does not exist.
-- The notification survives and the audit trail loses it. Nothing in the webhook changes
-- and nobody is paged. That is the whole cost of skipping this file, and it is invisible
-- from the outside, which is why it is written down here.
--
-- DRIFT FOUND IN THE OTHER DIRECTION, and fixed in the same commit as this file: the live
-- constraint allows 'flight', which was NOT in the SendArgs union. Nothing in this repo
-- sends it — the only mail call sites are app/api/agents/register/route.ts:387 ('receipt')
-- and app/api/stripe/webhook/route.ts:154 ('operational') — so a 'flight' row is written
-- by something outside this repo, or by a caller that no longer exists. It is preserved
-- here rather than dropped: this migration is not the place to decide a value the colony
-- may still be using, and removing it would break whatever writes it with no warning.
-- The union in lib/mail/sendEmail.ts now lists all four, so the type matches the table in
-- both directions.
--
-- MECHANICS. Postgres has no ALTER CONSTRAINT for a CHECK expression, so DROP then ADD is
-- the only route. Both statements are inside one transaction: the table is never without
-- its constraint from any other session's point of view. ADD CONSTRAINT validates every
-- existing row, so if the table somehow held a value outside the four, this fails loudly
-- and rolls back rather than half-applying. The lock is ACCESS EXCLUSIVE and held only for
-- the validation scan; email_sends is an append-only log, so a brief lock costs at most a
-- queued INSERT.

BEGIN;

ALTER TABLE email_sends DROP CONSTRAINT email_sends_category_check;

ALTER TABLE email_sends ADD CONSTRAINT email_sends_category_check
  CHECK (category = ANY (ARRAY['receipt', 'marketing', 'flight', 'operational']));

COMMIT;

-- VERIFY after running — this must come back with all four values:
--   SELECT conname, pg_get_constraintdef(oid)
--     FROM pg_constraint
--    WHERE conrelid = 'email_sends'::regclass AND conname = 'email_sends_category_check';
--
-- And a live proof once a quarantine alert has fired:
--   SELECT to_email, category, template, status, created_at
--     FROM email_sends WHERE category = 'operational' ORDER BY created_at DESC LIMIT 5;
