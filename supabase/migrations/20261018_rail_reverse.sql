-- Migration M1b: rail_reverse — the fourth and last money-writing function
-- For: RAIL-DESIGN-v1.1 §6, §5.8, §15 row 5 · predicates R33, R34, R35, R60
-- Ticket: NIK-RAIL-005 · ruling R-H (Francis, Oct 18)
-- Date: October 18, 2026
-- Run in: Supabase SQL editor, as postgres — AFTER Nikita's review. NOT RUN by any
--         deploy, and not by this session: no code path reaches it until it exists.
-- Rollback: 20261018_rail_reverse_rollback.sql (sibling, same directory)
--
-- DEPLOY ORDER IS MIGRATION FIRST, CODE SECOND, and unusually for this rail the gap is
-- harmless in both directions:
--   * function present, code not yet deployed — nothing calls it; it is inert.
--   * code deployed, function absent — the rpc errors, the handler routes that to
--     failAfterClaim, the claim is released and Stripe retries until the function
--     exists (R59, the same gap rail_accrue has). No accrual and no reversal is lost,
--     but every refund event burns retries, so the order above is still the order.
--
-- WHAT THIS FILE DOES AND DOES NOT DO.
-- It creates ONE function. It creates no table, alters no table, inserts no row,
-- changes no grant on any table, and touches no existing function. Every column it
-- writes already exists: M1 added referral_earnings.reversed_at (:110) and
-- .reversal_reason (:111), and M1's status CHECK already admits 'reversed' (:141).
-- So this migration is additive in the strongest sense — the only thing in the
-- database that differs afterwards is that one name exists.
--
-- WHY A FOURTH FUNCTION RATHER THAN AN UPDATE IN THE ROUTE (ruling R-H).
-- NIK-RAIL-005's measure established that the guard's RULE C would EXEMPT a direct
-- UPDATE written under lib/rail/ — allowed, printed, exit 0 — and that the guard's
-- summary would then stop saying "0 exemption(s)", the line three commits have been
-- signed off against. R-H closes that: no code under app/ or lib/ writes to
-- referral_earnings, ever, and R60's write fence now names four functions instead of
-- three. RULE D (this commit) is what makes the fourth name checkable rather than
-- merely intended.
--
-- hive_revenue IS NOT MODIFIED, DELIBERATELY. Design §6 is silent on how a refund
-- should show up in revenue accounting, and this migration keeps that silence rather
-- than inventing an answer in SQL: a reversal that also reduced revenue would be a
-- bookkeeping decision made by a build hand. The revenue row stays as the historical
-- record that the rail saw this invoice (F1) — which is exactly what makes `known`
-- answerable below. Carried to RAIL-DESIGN v1.2 as an open item.
--
-- WHAT `known`, `reversed` AND `untouched` MEAN TO THE CALLER.
--   known     — did the rail ever accrue on this invoice ref in this mode? FALSE for a
--               pre-rail invoice, a non-membership payment, or a ref we resolved wrongly.
--               The caller records a row and answers 200; a retry cannot fix it.
--   reversed  — how many PENDING accrual rows moved to 'reversed'. 0 on a second call
--               for the same ref, which is not an error: the first call did the work.
--   untouched — how many of that ref's rows are already 'in_transit' or 'paid'. Money
--               that has left, or is leaving. This function does not chase it: R34, no
--               debit, no negative amount, no transfer touched. A non-zero value is the
--               refund_after_payout case and the caller alerts a human (R35).
--
-- CONCURRENCY, stated so it can be tested (proposed predicate R63).
-- rail_open_payout takes `FOR UPDATE SKIP LOCKED` over the same pending rows. Under
-- READ COMMITTED, whichever transaction locks a row first wins and the other sees the
-- committed outcome:
--   * open locks first  — this UPDATE blocks, then re-evaluates status = 'pending' on
--     the committed row, finds 'in_transit', skips it, and counts it as untouched.
--   * reversal locks first — the open's SKIP LOCKED passes straight over the row, so it
--     is not swept into the payout, and it ends as 'reversed'.
-- No row can be both reversed and paid, and neither call needs to know about the other.

BEGIN;

-- ── rail_reverse ────────────────────────────────────────────────────────────
-- Every column reference below is qualified with a table alias. That is not style:
-- M1's first run raised 42703 at RUN TIME because RETURNS TABLE column names become
-- PL/pgSQL variables that collide with the table's own columns, and the collision is
-- invisible to CREATE FUNCTION. The locals are all v_* for the same reason.
CREATE OR REPLACE FUNCTION rail_reverse(
  p_invoice_ref  text,
  p_reason       text,
  p_livemode     boolean
) RETURNS TABLE (known boolean, reversed integer, untouched integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_known     boolean;
  v_reversed  integer;
  v_untouched integer;
BEGIN
  -- (1) validate, and write nothing on a bad argument. 22023 (invalid_parameter_value)
  -- is the same code the other three raise, and the handler turns any rpc error into a
  -- released claim and a 500 — so a malformed call is retried, not silently dropped.
  IF p_invoice_ref IS NULL OR btrim(p_invoice_ref) = '' THEN
    RAISE EXCEPTION 'rail_reverse: p_invoice_ref is required' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('refund', 'dispute') THEN
    RAISE EXCEPTION 'rail_reverse: p_reason must be refund or dispute' USING ERRCODE = '22023';
  END IF;
  IF p_livemode IS NULL THEN
    RAISE EXCEPTION 'rail_reverse: p_livemode is required' USING ERRCODE = '22023';
  END IF;

  -- (2) did the rail ever see this invoice? The hive_revenue row IS the claim on an
  -- invoice (F1), so its existence is the question, and livemode is part of the key:
  -- a test-mode ref must never answer for a live one.
  v_known := EXISTS (
    SELECT 1
      FROM hive_revenue h
     WHERE h.stripe_invoice_ref = p_invoice_ref
       AND h.livemode           = p_livemode
  );

  -- (3) reverse the PENDING rows only (R33). 'in_transit' and 'paid' are left exactly
  -- as they are — that is R34 in one clause.
  UPDATE referral_earnings re
     SET status          = 'reversed',
         reversed_at     = now(),
         reversal_reason = p_reason
   WHERE re.stripe_invoice_ref = p_invoice_ref
     AND re.livemode           = p_livemode
     AND re.status             = 'pending';
  GET DIAGNOSTICS v_reversed = ROW_COUNT;

  -- (4) and say how much money this refund cannot reach.
  SELECT count(*)::integer
    INTO v_untouched
    FROM referral_earnings re
   WHERE re.stripe_invoice_ref = p_invoice_ref
     AND re.livemode           = p_livemode
     AND re.status IN ('in_transit', 'paid');

  RETURN QUERY SELECT v_known, v_reversed, v_untouched;
END;
$fn$;

COMMENT ON FUNCTION rail_reverse(text, text, boolean) IS
  'RAIL-DESIGN-v1.1 §6 · NIK-RAIL-005 · reverses the PENDING accruals of one invoice '
  'ref in one mode. Never touches in_transit or paid rows (R34) and never modifies '
  'hive_revenue. Returns (known, reversed, untouched); a repeat call reverses 0 and is '
  'not an error.';

-- The same posture as the other three: nothing but the service role, from inside the
-- webhook route, may execute it. PUBLIC is revoked explicitly because a new function
-- is granted to PUBLIC by default — the one line whose absence would undo the rest.
REVOKE EXECUTE ON FUNCTION rail_reverse(text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION rail_reverse(text, text, boolean)
  TO service_role;

COMMIT;

-- VERIFY after running:
--   SELECT proname, prosecdef, proconfig FROM pg_proc
--    WHERE proname LIKE 'rail\_%' ORDER BY proname;
--     -- four rows: rail_accrue, rail_close_payout, rail_open_payout, rail_reverse
--     -- prosecdef = t and proconfig = {search_path=public, pg_temp} on all four
--   SELECT has_function_privilege('anon', 'rail_reverse(text,text,boolean)', 'EXECUTE');
--     -- f
--   SELECT has_function_privilege('service_role', 'rail_reverse(text,text,boolean)', 'EXECUTE');
--     -- t
