-- tests/rail/sql/rail_reverse.r63.setup.sql
-- ----------------------------------------------------------------------------
-- R63 two-session proof · FIXTURE. Ticket NIK-RAIL-005, addendum M-1.
-- LOCAL SCRATCH DATABASE ONLY (psql -d railtest). Never Supabase.
--
-- Committed, because the point of the proof is that two SEPARATE transactions see
-- each other's committed state and contend for the same row lock — which they cannot
-- do inside one rolled-back transaction, the way the rest of the self-test works.
-- rail_reverse.r63.sh is the runner; it calls this, then A and B, then the teardown.
--
-- THE FIXTURE IS DELIBERATELY ONE ROW. rail_open_payout refuses a sweep whose pending
-- total is under 500 cents (M1, 'v_total < 500'), so E1 gets exactly one level-1 row
-- worth 1580 cents from a 7900-cent Honey Maker invoice. One row means B's SKIP
-- LOCKED has nothing else to find: if B still opens a payout, the lock was not
-- respected, and that is the failure this proof is looking for.
-- ----------------------------------------------------------------------------
BEGIN;

INSERT INTO agents (id, name, email, status, is_staff, tier,
                    stripe_connect_account_id, connect_payouts_enabled,
                    connect_details_submitted, connect_livemode)
VALUES
  ('63000000-0000-4000-8000-000000000001', 'R63_SRC', 'r63_src@example.test',
   'active', false, 'worker_bee', NULL, false, false, NULL),
  ('63000000-0000-4000-8000-000000000002', 'R63_E1', 'r63_e1@example.test',
   'active', false, 'worker_bee', 'acct_r63_e1', true, true, false)
ON CONFLICT (id) DO NOTHING;

SELECT rail_accrue(
  'in_X',
  '63000000-0000-4000-8000-000000000001',
  7900,
  date_trunc('month', (now() AT TIME ZONE 'utc'))::date,
  false,
  jsonb_build_array(
    jsonb_build_object('earning_agent_id', '63000000-0000-4000-8000-000000000002',
                       'level', 1, 'rate_bps', 2000, 'amount_cents', 1580)
  )
) AS rows_accrued;

COMMIT;

\echo '-- fixture state: one PENDING row for E1, 1580 cents, ref in_X --'
SELECT re.stripe_invoice_ref, re.earning_agent_id, re.amount_cents, re.status,
       re.reversed_at, re.reversal_reason
  FROM referral_earnings re
 WHERE re.stripe_invoice_ref = 'in_X'
 ORDER BY re.level;
SELECT count(*) AS payouts_for_e1
  FROM payouts p
 WHERE p.agent_id = '63000000-0000-4000-8000-000000000002';
