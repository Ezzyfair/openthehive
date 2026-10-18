-- tests/rail/sql/rail_reverse.selftest.sql
-- ----------------------------------------------------------------------------
-- THE HIVE — M1b self-test. RAIL-DESIGN-v1.1 §6. Ticket NIK-RAIL-005 §1.
--
-- RUN AGAINST THE LOCAL SCRATCH DATABASE ONLY:
--   psql -d railtest -f supabase/tests/rail_m1_stub.sql
--   psql -d railtest -f supabase/migrations/20261013_rail_m1.sql
--   psql -d railtest -f supabase/migrations/20261018_rail_reverse.sql
--   psql -d railtest -f tests/rail/sql/rail_reverse.selftest.sql
-- NEVER against Supabase. This session ran exactly the four lines above; the output
-- is in the packet.
--
-- Same shape as supabase/tests/rail_m1_selftest.sql: every check RAISES on failure, so
-- the script either reaches 'ALL ASSERTIONS PASSED' or aborts at the first broken one,
-- and the whole thing runs in ONE transaction that is ROLLED BACK, leaving no row
-- behind. expect_raise checks the SQLSTATE and not merely that something failed —
-- a typo that raised 42703 instead of the contract's 22023 would otherwise pass.
--
-- PATH NOTE. The ticket names this file tests/rail/sql/; the M1 stub and self-test live
-- in supabase/tests/. Both locations are now in use, which is worth settling in v1.2.
--
-- R63 IS PROVEN IN TWO HALVES, AND ONLY ONE OF THEM IS HERE (addendum M-1).
--   FORWARD  — the payout opens first, so the reversal finds the row in_transit and
--              counts it as `untouched`, touching nothing: the in_B block below.
--   REVERSE  — the reversal locks first, so the payout's FOR UPDATE SKIP LOCKED
--              passes over the row and opens nothing: tests/rail/sql/rail_reverse.r63.sh,
--              a sibling runner, because that half needs TWO concurrent sessions and a
--              single psql script cannot hold one transaction open while another runs.
--              Run it with: bash tests/rail/sql/rail_reverse.r63.sh
-- ----------------------------------------------------------------------------
BEGIN;

SET LOCAL client_min_messages = NOTICE;

-- ── helpers (same two as the M1 self-test) ──────────────────────────────────
CREATE FUNCTION pg_temp.expect_raise(p_sql text, p_errcode text, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_state text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN others THEN
    v_state := SQLSTATE;
    IF v_state <> p_errcode THEN
      RAISE EXCEPTION 'FAIL [%]: expected SQLSTATE % but got % (%)',
        p_label, p_errcode, v_state, SQLERRM;
    END IF;
    RAISE NOTICE '  ok   % (raised % as required)', p_label, p_errcode;
    RETURN;
  END;
  RAISE EXCEPTION 'FAIL [%]: the statement SUCCEEDED but should have raised %',
    p_label, p_errcode;
END $$;

CREATE FUNCTION pg_temp.expect_eq(p_got anyelement, p_want anyelement, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_got IS DISTINCT FROM p_want THEN
    RAISE EXCEPTION 'FAIL [%]: got %, want %', p_label, p_got, p_want;
  END IF;
  RAISE NOTICE '  ok   % (= %)', p_label, p_want;
END $$;

-- ── fixtures ────────────────────────────────────────────────────────────────
--   SRC  the paying member        E1  an eligible earner (level 1)
--   E2   a second eligible earner (level 2)
-- The ids differ from the M1 self-test's so the two can run against one scratch
-- database in either order without colliding on agents.email (NOT NULL UNIQUE).
CREATE TEMP TABLE t5_ids (k text PRIMARY KEY, v uuid);
INSERT INTO t5_ids VALUES
  ('src', '55555555-5555-4555-8555-555555555555'),
  ('e1',  '66666666-6666-4666-8666-666666666666'),
  ('e2',  '77777777-7777-4777-8777-777777777777');

INSERT INTO agents (id, name, email, status, is_staff, tier,
                    stripe_connect_account_id, connect_payouts_enabled,
                    connect_details_submitted, connect_livemode)
VALUES
  ((SELECT v FROM t5_ids WHERE k='src'), 'REVTEST_SRC', 'revtest_src@example.test',
   'active', false, 'worker_bee', NULL, false, false, NULL),
  ((SELECT v FROM t5_ids WHERE k='e1'),  'REVTEST_E1',  'revtest_e1@example.test',
   'active', false, 'worker_bee', 'acct_revtest_e1', true, true, false),
  ((SELECT v FROM t5_ids WHERE k='e2'),  'REVTEST_E2',  'revtest_e2@example.test',
   'active', false, 'worker_bee', 'acct_revtest_e2', true, true, false);

DO $outer$
DECLARE
  v_src    uuid := (SELECT v FROM t5_ids WHERE k='src');
  v_e1     uuid := (SELECT v FROM t5_ids WHERE k='e1');
  v_e2     uuid := (SELECT v FROM t5_ids WHERE k='e2');
  v_month  date := date_trunc('month', (now() AT TIME ZONE 'utc'))::date;
  v_rows   jsonb;
  v_rows_b jsonb;
  v_n      integer;
  v_cnt    bigint;
  v_known  boolean;
  v_rev    integer;
  v_unt    integer;
  v_payout uuid;
  v_amount integer;
  v_dest   text;
  v_when   timestamptz;
  v_reason text;
BEGIN
  v_rows := jsonb_build_array(
    jsonb_build_object('earning_agent_id', v_e1::text, 'level', 1, 'rate_bps', 2000, 'amount_cents', 200),
    jsonb_build_object('earning_agent_id', v_e2::text, 'level', 2, 'rate_bps', 1000, 'amount_cents', 100)
  );

  -- ══ 1 · the refund of an invoice whose accruals are still pending ══════════
  RAISE NOTICE '── rail_reverse · a refund of pending accruals ──';

  v_n := rail_accrue('in_A', v_src, 1000, v_month, false, v_rows);
  PERFORM pg_temp.expect_eq(v_n, 2, 'in_A accrued 2 rows');

  SELECT r.known, r.reversed, r.untouched INTO v_known, v_rev, v_unt
    FROM rail_reverse('in_A', 'refund', false) r;
  PERFORM pg_temp.expect_eq(v_known, true, 'in_A: known');
  PERFORM pg_temp.expect_eq(v_rev,   2,    'in_A: reversed 2');
  PERFORM pg_temp.expect_eq(v_unt,   0,    'in_A: untouched 0');

  SELECT count(*) INTO v_cnt FROM referral_earnings re
   WHERE re.stripe_invoice_ref = 'in_A' AND re.status = 'reversed';
  PERFORM pg_temp.expect_eq(v_cnt, 2::bigint, 'in_A: both rows are status reversed');

  SELECT count(*) INTO v_cnt FROM referral_earnings re
   WHERE re.stripe_invoice_ref = 'in_A' AND re.reversed_at IS NULL;
  PERFORM pg_temp.expect_eq(v_cnt, 0::bigint, 'in_A: reversed_at set on both rows');

  SELECT DISTINCT re.reversal_reason INTO v_reason FROM referral_earnings re
   WHERE re.stripe_invoice_ref = 'in_A';
  PERFORM pg_temp.expect_eq(v_reason, 'refund', 'in_A: reversal_reason is refund');

  -- hive_revenue is NOT touched (design §6 stays silent; M1b keeps that silence)
  SELECT count(*) INTO v_cnt FROM hive_revenue h WHERE h.stripe_invoice_ref = 'in_A';
  PERFORM pg_temp.expect_eq(v_cnt, 1::bigint, 'in_A: the revenue row still stands');

  -- ══ 2 · the second call is idempotent, not an error ════════════════════════
  RAISE NOTICE '── rail_reverse · the repeat ──';

  SELECT r.known, r.reversed, r.untouched INTO v_known, v_rev, v_unt
    FROM rail_reverse('in_A', 'refund', false) r;
  PERFORM pg_temp.expect_eq(v_known, true, 'in_A repeat: still known');
  PERFORM pg_temp.expect_eq(v_rev,   0,    'in_A repeat: reverses 0');
  PERFORM pg_temp.expect_eq(v_unt,   0,    'in_A repeat: untouched 0');

  SELECT min(re.reversed_at) INTO v_when FROM referral_earnings re
   WHERE re.stripe_invoice_ref = 'in_A';
  PERFORM pg_temp.expect_eq((v_when IS NOT NULL), true,
    'in_A repeat: the original reversed_at was not overwritten with a new one');

  -- ══ 3 · a refund AFTER a payout opened — R34, nothing is clawed back ══════
  RAISE NOTICE '── rail_reverse · refund after payout (R34, R35) ──';

  -- in_B is a HONEY MAKER invoice, 7900 cents, so E1's level-1 share is 1580 —
  -- rail_open_payout refuses a sweep under 500 cents (M1, 'v_total < 500'), which the
  -- first run of this self-test found the hard way with a 1000-cent fixture.
  v_rows_b := jsonb_build_array(
    jsonb_build_object('earning_agent_id', v_e1::text, 'level', 1, 'rate_bps', 2000, 'amount_cents', 1580),
    jsonb_build_object('earning_agent_id', v_e2::text, 'level', 2, 'rate_bps', 1000, 'amount_cents', 790)
  );
  v_n := rail_accrue('in_B', v_src, 7900, v_month, false, v_rows_b);
  PERFORM pg_temp.expect_eq(v_n, 2, 'in_B accrued 2 rows');

  -- rail_open_payout sweeps E1's pending rows into a payout: they become in_transit.
  --
  -- THE CUTOFF IS now() + 1 MINUTE, not now(). M1's sweep filters
  -- `re.created_at < p_cutoff` strictly, and now() is the TRANSACTION timestamp — it
  -- does not advance inside this DO block — so rows this self-test just inserted have
  -- created_at = now() exactly and a cutoff of now() selects none of them. The second
  -- run of this file found that: the payout came back NULL with 1580 pending cents
  -- sitting there. A real monthly run has the rows from days earlier and never sees it.
  SELECT o.payout_id, o.amount_cents, o.destination_account
    INTO v_payout, v_amount, v_dest
    FROM rail_open_payout(v_e1, v_month, now() + interval '1 minute', false) o;
  PERFORM pg_temp.expect_eq((v_payout IS NOT NULL), true, 'in_B: a payout opened for E1');

  SELECT count(*) INTO v_cnt FROM referral_earnings re
   WHERE re.stripe_invoice_ref = 'in_B' AND re.status = 'in_transit';
  PERFORM pg_temp.expect_eq(v_cnt, 1::bigint, 'in_B: E1 row is in_transit');

  -- E2's row is still pending, so this refund reverses one and cannot reach the other.
  SELECT r.known, r.reversed, r.untouched INTO v_known, v_rev, v_unt
    FROM rail_reverse('in_B', 'refund', false) r;
  PERFORM pg_temp.expect_eq(v_known, true, 'in_B: known');
  PERFORM pg_temp.expect_eq(v_rev,   1,    'in_B: reversed only the pending row');
  PERFORM pg_temp.expect_eq(v_unt,   1,    'in_B: reported 1 untouched (in_transit)');

  SELECT count(*) INTO v_cnt FROM referral_earnings re
   WHERE re.stripe_invoice_ref = 'in_B' AND re.status = 'in_transit'
     AND re.reversed_at IS NULL AND re.reversal_reason IS NULL;
  PERFORM pg_temp.expect_eq(v_cnt, 1::bigint,
    'in_B: the in_transit row is UNCHANGED — no reversed_at, no reason (R34)');

  -- and once that payout is paid, a further refund still cannot touch it
  PERFORM rail_close_payout(v_payout, 'paid', 'tr_revtest_B', NULL);
  SELECT count(*) INTO v_cnt FROM referral_earnings re
   WHERE re.stripe_invoice_ref = 'in_B' AND re.status = 'paid';
  PERFORM pg_temp.expect_eq(v_cnt, 1::bigint, 'in_B: the swept row is now paid');

  SELECT r.known, r.reversed, r.untouched INTO v_known, v_rev, v_unt
    FROM rail_reverse('in_B', 'refund', false) r;
  PERFORM pg_temp.expect_eq(v_rev, 0, 'in_B after payment: reverses 0');
  PERFORM pg_temp.expect_eq(v_unt, 1, 'in_B after payment: 1 untouched (paid)');

  -- ══ 4 · an invoice the rail never saw ═════════════════════════════════════
  RAISE NOTICE '── rail_reverse · an unknown ref ──';

  SELECT r.known, r.reversed, r.untouched INTO v_known, v_rev, v_unt
    FROM rail_reverse('in_NEVER_SEEN', 'refund', false) r;
  PERFORM pg_temp.expect_eq(v_known, false, 'unknown ref: known false');
  PERFORM pg_temp.expect_eq(v_rev,   0,     'unknown ref: reversed 0');
  PERFORM pg_temp.expect_eq(v_unt,   0,     'unknown ref: untouched 0');

  -- livemode is part of the key: a live-mode call must not find the test-mode rows.
  SELECT r.known, r.reversed INTO v_known, v_rev
    FROM rail_reverse('in_A', 'refund', true) r;
  PERFORM pg_temp.expect_eq(v_known, false, 'in_A in LIVE mode: not known (mode is part of the key)');
  PERFORM pg_temp.expect_eq(v_rev,   0,     'in_A in LIVE mode: reverses nothing');

  -- ══ 5 · the dispute reason, and the reasons that are refused ══════════════
  RAISE NOTICE '── rail_reverse · argument validation ──';

  v_n := rail_accrue('in_C', v_src, 1000, v_month, false, v_rows);
  SELECT r.reversed INTO v_rev FROM rail_reverse('in_C', 'dispute', false) r;
  PERFORM pg_temp.expect_eq(v_rev, 2, 'in_C: a dispute reverses the same way a refund does');
  SELECT DISTINCT re.reversal_reason INTO v_reason FROM referral_earnings re
   WHERE re.stripe_invoice_ref = 'in_C';
  PERFORM pg_temp.expect_eq(v_reason, 'dispute', 'in_C: reversal_reason is dispute');

  PERFORM pg_temp.expect_raise(
    $q$ SELECT * FROM rail_reverse('in_A', 'chargeback', false) $q$, '22023',
    'p_reason chargeback is refused');
  PERFORM pg_temp.expect_raise(
    $q$ SELECT * FROM rail_reverse(NULL, 'refund', false) $q$, '22023',
    'a null p_invoice_ref is refused');
  PERFORM pg_temp.expect_raise(
    $q$ SELECT * FROM rail_reverse('   ', 'refund', false) $q$, '22023',
    'a blank p_invoice_ref is refused');
  PERFORM pg_temp.expect_raise(
    $q$ SELECT * FROM rail_reverse('in_A', NULL, false) $q$, '22023',
    'a null p_reason is refused');
  PERFORM pg_temp.expect_raise(
    $q$ SELECT * FROM rail_reverse('in_A', 'refund', NULL) $q$, '22023',
    'a null p_livemode is refused');

  -- a refused call writes nothing: in_C's rows are exactly as the dispute left them
  SELECT count(*) INTO v_cnt FROM referral_earnings re
   WHERE re.stripe_invoice_ref = 'in_C' AND re.status = 'reversed';
  PERFORM pg_temp.expect_eq(v_cnt, 2::bigint, 'the refused calls changed nothing');

  RAISE NOTICE '';
  RAISE NOTICE 'ALL ASSERTIONS PASSED (rail_reverse)';
END $outer$;

-- ── grants, outside the DO block so they read as plain SQL ──────────────────
SELECT has_function_privilege('anon', 'rail_reverse(text,text,boolean)', 'EXECUTE')
         AS anon_can_execute_expect_f,
       has_function_privilege('authenticated', 'rail_reverse(text,text,boolean)', 'EXECUTE')
         AS authenticated_can_execute_expect_f,
       has_function_privilege('service_role', 'rail_reverse(text,text,boolean)', 'EXECUTE')
         AS service_role_can_execute_expect_t;

-- the four functions, their security flag and their pinned search_path
SELECT p.proname, p.prosecdef AS security_definer, p.proconfig
  FROM pg_proc p
 WHERE p.proname LIKE 'rail\_%'
 ORDER BY p.proname;

ROLLBACK;
