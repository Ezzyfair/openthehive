-- tests/rail/sql/rail_reverse.r63.b.sql
-- ----------------------------------------------------------------------------
-- R63 two-session proof · SESSION B. Ticket NIK-RAIL-005, addendum M-1.
-- Run twice by the runner: once while session A holds its uncommitted reversal, and
-- once after A commits. Both times the answer must be THE SAME — no payout — and for
-- two different reasons, which is the whole content of R63's reverse direction:
--   while A holds   : the row is pending but LOCKED, so FOR UPDATE SKIP LOCKED passes
--                     over it, the sweep totals 0 and rail_open_payout returns nothing
--   after A commits : the row is 'reversed', so it is not pending and never eligible
-- Either way nothing is swept into a payout, and no row is both reversed and paid.
--
-- This file ASSERTS rather than reports: each check raises, so a wrong answer makes
-- the runner's psql exit non-zero.
-- ----------------------------------------------------------------------------
\set ON_ERROR_STOP on

\echo '--- session B: rail_open_payout for E1 ---'
SELECT o.payout_id, o.amount_cents, o.destination_account
  FROM rail_open_payout('63000000-0000-4000-8000-000000000002',
                        date_trunc('month', (now() AT TIME ZONE 'utc'))::date,
                        now() + interval '1 minute',
                        false) o;

\echo '--- the row, as B sees it ---'
SELECT re.stripe_invoice_ref, re.status, re.payout_id,
       (re.reversed_at IS NOT NULL) AS has_reversed_at, re.reversal_reason
  FROM referral_earnings re
 WHERE re.stripe_invoice_ref = 'in_X';

\echo '--- assertions ---'
DO $$
DECLARE
  v_payouts  bigint;
  v_intrans  bigint;
  v_paid     bigint;
  v_assigned bigint;
BEGIN
  SELECT count(*) INTO v_payouts FROM payouts p
   WHERE p.agent_id = '63000000-0000-4000-8000-000000000002';
  IF v_payouts <> 0 THEN
    RAISE EXCEPTION 'FAIL [R63]: a payout was opened for E1 (% row(s)) — the reversal''s row lock was not respected', v_payouts;
  END IF;
  RAISE NOTICE '  ok   no payout exists for E1 (= 0)';

  SELECT count(*) INTO v_intrans FROM referral_earnings re
   WHERE re.stripe_invoice_ref = 'in_X' AND re.status = 'in_transit';
  IF v_intrans <> 0 THEN
    RAISE EXCEPTION 'FAIL [R63]: % row(s) went in_transit — swept despite the reversal', v_intrans;
  END IF;
  RAISE NOTICE '  ok   no in_X row is in_transit (= 0)';

  SELECT count(*) INTO v_paid FROM referral_earnings re
   WHERE re.stripe_invoice_ref = 'in_X' AND re.status = 'paid';
  IF v_paid <> 0 THEN
    RAISE EXCEPTION 'FAIL [R63]: % row(s) are paid — a row was both reversed and paid', v_paid;
  END IF;
  RAISE NOTICE '  ok   no in_X row is paid (= 0)';

  SELECT count(*) INTO v_assigned FROM referral_earnings re
   WHERE re.stripe_invoice_ref = 'in_X' AND re.payout_id IS NOT NULL;
  IF v_assigned <> 0 THEN
    RAISE EXCEPTION 'FAIL [R63]: % row(s) carry a payout_id', v_assigned;
  END IF;
  RAISE NOTICE '  ok   no in_X row carries a payout_id (= 0)';
END $$;
