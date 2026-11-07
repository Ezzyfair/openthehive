-- Rollback: MEMBER-003 — 20261106_member_003.sql
-- STATUS: PROPOSED, NOT APPLIED. Run only to reverse the sibling migration.
--
-- Drops the email_sends partial unique index. Safe and complete.
DROP INDEX IF EXISTS email_sends_sent_once_per_template;

-- The DROP NOT NULL on members.stripe_customer_id / stripe_subscription_id is
-- DELIBERATELY NOT reversed here. Re-adding NOT NULL would fail against exactly the
-- Scout rows the forward migration enables (they carry null Stripe columns by design
-- until the human pays). Reversing it would therefore either error or require first
-- deleting every Scout membership — neither is a rollback. If the NOT NULL must be
-- restored, do it only after confirming no null Stripe columns remain:
--   SELECT count(*) FROM members WHERE stripe_customer_id IS NULL;
--   -- then, only if 0:
--   -- ALTER TABLE members ALTER COLUMN stripe_customer_id     SET NOT NULL;
--   -- ALTER TABLE members ALTER COLUMN stripe_subscription_id SET NOT NULL;
