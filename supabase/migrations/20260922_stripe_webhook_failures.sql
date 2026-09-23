-- Migration: stripe_webhook_failures — the quarantine record
-- For: NIK-TWO-DOORS-001 MEDIUM · alert path (Francis ruling, Sept 22: row + email)
-- Ticket: NIK-TWO-DOORS-001
-- Date: September 22, 2026
-- Run in: Supabase SQL editor — AFTER Nikita's review. NOT RUN. No deploy runs this.
-- Rollback: 20260922_stripe_webhook_failures_rollback.sql (sibling, same directory)
--
-- RUN THIS TOGETHER WITH 20260922_stripe_events.sql, AND BOTH BEFORE THE CODE DEPLOYS.
-- The two are one unit: stripe_events is what makes an event claimed exactly once, and
-- this table is where an event that was claimed but could not be classified comes to
-- rest. Said plainly, and the order is not optional:
--   * if stripe_events is missing, the claim INSERT fails 42P01 and the route fails
--     closed with 500 on EVERY event — a full webhook outage until it exists;
--   * if THIS table is missing, the route still answers correctly (the quarantine write
--     is best-effort and its failure is swallowed and logged) but the only record of a
--     quarantined event is a console line and an email. The event is still claimed, so
--     Stripe will not retry it, and there is then nothing in the database to find it by.
-- Deploy order: both migrations, verify, then the code.
--
-- PURPOSE. app/api/stripe/webhook/route.ts used to answer an unrecognisable
-- checkout.session.completed with 400. Two things were wrong with that once the event is
-- claimed: a 400 makes Stripe retry, and a retry cannot change the session metadata that
-- caused it, so the retries are pure noise; and after the claim landed (commit ea5f91c)
-- the retries were answered 200 already_processed, so the event went silent and
-- unprocessed with no record anywhere. A quarantine row plus an email is the recovery
-- path: the money is at Stripe, the event is recorded here, and a human resolves it.
--
-- reason is TEXT and deliberately NOT constrained. Today it holds 'unrecognised_tier'
-- and 'claim_failed'. A CHECK would mean a migration every time a new failure becomes
-- describable, and the worst outcome of an unlisted reason is a row a human has to read
-- — whereas a rejected INSERT on this table would lose the only record of the failure.
--
-- detail is JSONB and holds only what the route already logs to the console: the
-- received tier value, the Stripe session id, the accepted values. NO PAYLOAD COPY and
-- no customer email — this table exists to point a human at Stripe, not to become a
-- second, partial record of money events that could disagree with it.
--
-- resolved_at is the whole workflow. NULL means open. A human sets it when the event has
-- been dealt with by hand. Nothing in the code writes it, by design: the route can tell
-- you an event failed, and it cannot tell you a person has finished with it.
--
-- POSTURE (same as the money tables, the Antenna tables and stripe_events): RLS enabled
-- with ZERO policies, REVOKE ALL FROM anon, authenticated, explicit GRANT to
-- service_role. Nothing but the service role inside the webhook route touches this.

BEGIN;

CREATE TABLE IF NOT EXISTS stripe_webhook_failures (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    TEXT        NOT NULL,      -- Stripe's evt_... — NOT unique, see below
  event_type  TEXT        NOT NULL,
  reason      TEXT        NOT NULL,      -- 'unrecognised_tier' | 'claim_failed' | future
  detail      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- event_id carries no UNIQUE constraint on purpose. A 'claim_failed' row is written when
-- the claim itself could not be made, so the same event CAN legitimately fail more than
-- once — Stripe retries a 500 — and every attempt should be recorded rather than the
-- second one being rejected. A unique index here would silently drop the evidence of a
-- repeated failure, which is the evidence that matters most.
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_failures_event ON stripe_webhook_failures(event_id);
-- The triage query: everything still open, newest first.
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_failures_open
  ON stripe_webhook_failures(created_at DESC) WHERE resolved_at IS NULL;

-- RLS: enabled, and no CREATE POLICY statement appears in this file by design.
ALTER TABLE stripe_webhook_failures ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE stripe_webhook_failures FROM anon, authenticated;

-- UPDATE is granted because resolved_at is set by hand through the service role; DELETE
-- is not, because a failure record that can be deleted is not a record.
GRANT SELECT, INSERT, UPDATE ON TABLE stripe_webhook_failures TO service_role;

COMMIT;

-- VERIFY after running:
--   SELECT count(*) FROM stripe_webhook_failures;                             -- 0
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'stripe_webhook_failures';  -- t
--   SELECT count(*) FROM pg_policies WHERE tablename = 'stripe_webhook_failures';   -- 0
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'stripe_webhook_failures';            -- service_role only
--
-- TRIAGE (the query the alert email quotes):
--   SELECT id, event_id, event_type, reason, detail, created_at
--     FROM stripe_webhook_failures
--    WHERE resolved_at IS NULL
--    ORDER BY created_at DESC;
