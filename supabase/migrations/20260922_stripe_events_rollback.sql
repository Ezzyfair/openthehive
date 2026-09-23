-- Rollback: stripe_events
-- Undoes: 20260922_stripe_events.sql (sibling, same directory)
-- Ticket: NIK-TWO-DOORS-001
-- Date: September 22, 2026
-- Run in: Supabase SQL editor.
--
-- REVERT THE CODE FIRST. While app/api/stripe/webhook/route.ts holds the claim INSERT,
-- dropping this table makes every claim fail with 42P01 and the route fails closed with
-- 500 on every event — Stripe retries everything and nothing is processed. The correct
-- order is the exact reverse of the forward direction: revert the route commit, confirm
-- the deploy, then run this.
--
-- DESTRUCTIVE, and the loss matters. Dropping the table discards the record of which
-- events have already been processed. If the code is later re-deployed against a fresh
-- table, every event Stripe still has in its retry window can be claimed again and
-- processed a second time. Export it first if that window is open:
--   SELECT event_id, event_type, received_at FROM stripe_events ORDER BY received_at;
--
-- No CASCADE: nothing should depend on this table, and if something has come to, the
-- DROP should fail loudly rather than take the dependent object with it.

BEGIN;

DROP TABLE IF EXISTS stripe_events;

COMMIT;

-- Nothing else to undo: the forward migration created no type, altered no existing
-- table, and added no column anywhere.
