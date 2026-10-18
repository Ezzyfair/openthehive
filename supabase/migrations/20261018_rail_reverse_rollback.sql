-- Rollback for 20261018_rail_reverse.sql (M1b) — NIK-RAIL-005
-- Date: October 18, 2026
-- Run in: Supabase SQL editor, as postgres.
--
-- Drops the one function the forward migration created, and nothing else. There is
-- nothing else to undo: M1b created no table, altered no table, wrote no row and
-- changed no grant on any table, so reversing it is one DROP.
--
-- WHAT THIS DOES NOT UNDO, said plainly. Rows already moved to status 'reversed' with
-- reversed_at and reversal_reason set STAY THAT WAY. They are correct — a refund did
-- happen — and 'reversed' is a status M1 already admits, so those rows remain valid
-- without this function. Dropping it removes the ability to reverse, not the record of
-- reversals. If the intent is to undo a specific reversal, that is a hand-written
-- UPDATE under review, not this file.
--
-- After this runs, any deployed code calling rpc('rail_reverse', …) errors; the handler
-- releases the event claim and answers 500, so Stripe retries the refund event rather
-- than losing it (R59). Expect retries for as long as the function is absent.

BEGIN;

DROP FUNCTION IF EXISTS rail_reverse(text, text, boolean);

COMMIT;

-- VERIFY after running:
--   SELECT proname FROM pg_proc WHERE proname LIKE 'rail\_%' ORDER BY proname;
--     -- three rows: rail_accrue, rail_close_payout, rail_open_payout
