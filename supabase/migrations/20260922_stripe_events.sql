-- Migration: stripe_events — the webhook replay claim
-- For: NIK-TWO-DOORS-001 HIGH, the design reported in NIK-TWO-DOORS-001-chunk-04.txt
-- Ticket: NIK-TWO-DOORS-001
-- Date: September 22, 2026
-- Run in: Supabase SQL editor — AFTER Nikita's review. NOT RUN. No deploy runs this.
-- Rollback: 20260922_stripe_events_rollback.sql (sibling, same directory)
--
-- PURPOSE. app/api/stripe/webhook/route.ts had no event-level idempotency: a valid
-- Stripe signature stays valid on every replay, so Stripe's at-least-once retry — or a
-- replayed capture — ran the whole handler again. One row per event.id is the claim.
-- The PRIMARY KEY is the decision: the route INSERTs before doing any work and reads
-- 23505 as "already processed". No SELECT-then-INSERT, because that pair is itself a
-- race under concurrent delivery; only a unique index settles it.
--
-- ORDER OF OPERATIONS — THIS FILE RUNS FIRST, THEN THE CODE DEPLOYS.
-- Said plainly: if the code reaches production before this table exists, the claim
-- INSERT fails with 42P01 (undefined_table) on EVERY event, and the route is deliberate
-- about that — it fails CLOSED and returns 500. Stripe then retries every event and
-- nothing is processed: no membership activated, no cascade fired, no chamber greeting.
-- Payments still succeed at Stripe; the colony simply never hears about them until the
-- table exists, at which point the retries land and the backlog processes normally.
-- Failing closed is the correct behaviour — a handler that cannot tell a new event from
-- a replay must not process it — but it means the deploy order is not optional.
--
-- WHAT IS DELIBERATELY NOT HERE.
--   No FK, no agent_id, no payload copy. This table answers exactly one question —
--   "have I seen this event.id?" — and holding more would make it a second, partial
--   record of money events that could disagree with Stripe.
--   No TTL or prune. The rows are ~80 bytes and Stripe's own retry window is days;
--   a prune is a later decision, and pruning too eagerly would re-open the replay
--   window for exactly the events most likely to be retried.
--
-- KNOWN LIMIT (reported, not fixed here). The claim commits in its own transaction,
-- separate from the work that follows. If the function dies mid-handler the event is
-- claimed and its remaining work is never done, and Stripe's retry is answered 200.
-- That trade is acceptable only because the post-claim work is itself largely
-- idempotent (referral_earnings is guarded on (source_agent_id, subscription_month),
-- the cohort top-up adds only new skills, the members/agents writes are fixed-value)
-- and a dropped event is recoverable by hand from the Stripe dashboard, while a double
-- cascade moves money. The stronger property needs the claim and the work in ONE
-- transaction — a SECURITY DEFINER function per event type — and that is its own design.
--
-- POSTURE (same as the money tables and the Antenna tables): RLS enabled with ZERO
-- policies, REVOKE ALL FROM anon, authenticated, explicit GRANT to service_role.
-- Nothing but the service role inside the webhook route touches this table.

BEGIN;

CREATE TABLE IF NOT EXISTS stripe_events (
  event_id    TEXT        PRIMARY KEY,          -- Stripe's evt_... — the claim key
  event_type  TEXT        NOT NULL,             -- for reading the trail, never branched on
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: enabled, and no CREATE POLICY statement appears in this file by design.
-- With RLS on and zero policies, every role without BYPASSRLS reads and writes nothing.
ALTER TABLE stripe_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE stripe_events FROM anon, authenticated;

-- SELECT and INSERT only. The route never updates or deletes a claim: a claim that
-- could be withdrawn is not a claim, and DELETE is what a replay attack would want.
GRANT SELECT, INSERT ON TABLE stripe_events TO service_role;

COMMIT;

-- VERIFY after running:
--   SELECT count(*) FROM stripe_events;                       -- 0
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'stripe_events';   -- t
--   SELECT count(*) FROM pg_policies WHERE tablename = 'stripe_events';    -- 0
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'stripe_events';                      -- service_role only
