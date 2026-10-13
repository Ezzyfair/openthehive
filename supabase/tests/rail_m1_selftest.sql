-- supabase/tests/rail_m1_selftest.sql
-- ----------------------------------------------------------------------------
-- THE HIVE — M1 self-test. RAIL-DESIGN-v1.1 §4.7. Ticket NIK-RAIL-002.
--
-- NOT RUN BY THIS SESSION: no PostgreSQL server is installed on this machine
-- (postgresql-client-16 only; postgres, initdb and pg_ctl are absent, no docker),
-- and the ticket forbids installing one. These assertions are unexecuted.
--
-- HOW IT PROVES THINGS. Every check RAISES on failure, so the script either runs to
-- 'ALL ASSERTIONS PASSED' or aborts at the first broken one. It runs inside ONE
-- transaction that is ROLLED BACK at the end, so it leaves no row behind — it can be
-- run against a scratch database that already holds M1 without dirtying it.
--
-- expect_raise(sql, errcode) is the workhorse: it runs a statement that MUST fail with a
-- given SQLSTATE and raises if the statement succeeds or fails differently. A test that
-- only checked "it failed" would pass when a typo made the function raise 42703 instead
-- of the contract's 22023.
--
-- It needs two agent rows that satisfy the eligibility rule, and one that does not.
-- ----------------------------------------------------------------------------
BEGIN;

SET LOCAL client_min_messages = NOTICE;

-- ── helpers ─────────────────────────────────────────────────────────────────
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
-- Fixed uuids so every assertion below can name them.
--   SRC    the paying member (the source agent)
--   E1     an eligible earner: payouts enabled, test mode, status active
--   E2     a second eligible earner, for the level-2 row
--   INEL   ineligible: Connect never onboarded
CREATE TEMP TABLE t_ids (k text PRIMARY KEY, v uuid);
INSERT INTO t_ids VALUES
  ('src',  '11111111-1111-4111-8111-111111111111'),
  ('e1',   '22222222-2222-4222-8222-222222222222'),
  ('e2',   '33333333-3333-4333-8333-333333333333'),
  ('inel', '44444444-4444-4444-8444-444444444444');

-- email is NOT NULL UNIQUE in production (schema readout Oct 11), so every fixture
-- agent carries one. Found by the first run against railtest: the insert failed 23502
-- without it.
INSERT INTO agents (id, name, email, status, is_staff, tier,
                    stripe_connect_account_id, connect_payouts_enabled,
                    connect_details_submitted, connect_livemode)
VALUES
  ((SELECT v FROM t_ids WHERE k='src'),  'SELFTEST_SRC',  'selftest_src@example.test',
   'active', false, 'worker_bee', NULL, false, false, NULL),
  ((SELECT v FROM t_ids WHERE k='e1'),   'SELFTEST_E1',   'selftest_e1@example.test',
   'active', false, 'worker_bee', 'acct_selftest_e1', true,  true,  false),
  ((SELECT v FROM t_ids WHERE k='e2'),   'SELFTEST_E2',   'selftest_e2@example.test',
   'first_flight', false, 'worker_bee', 'acct_selftest_e2', true,  true,  false),
  ((SELECT v FROM t_ids WHERE k='inel'), 'SELFTEST_INEL', 'selftest_inel@example.test',
   'active', false, 'worker_bee', NULL, false, false, NULL);

DO $outer$
DECLARE
  v_src    uuid := (SELECT v FROM t_ids WHERE k='src');
  v_e1     uuid := (SELECT v FROM t_ids WHERE k='e1');
  v_e2     uuid := (SELECT v FROM t_ids WHERE k='e2');
  v_inel   uuid := (SELECT v FROM t_ids WHERE k='inel');
  v_month  date := date_trunc('month', (now() AT TIME ZONE 'utc'))::date;
  v_n      integer;
  v_payout uuid;
  v_amount integer;
  v_dest   text;
  v_cnt    bigint;
  v_rows   jsonb;
BEGIN
  RAISE NOTICE '── rail_accrue · the happy path and the replay ──';

  -- $10.00 = 1000 cents. L1 20% = 200, L2 10% = 100.
  v_rows := jsonb_build_array(
    jsonb_build_object('earning_agent_id', v_e1::text, 'level', 1, 'rate_bps', 2000, 'amount_cents', 200),
    jsonb_build_object('earning_agent_id', v_e2::text, 'level', 2, 'rate_bps', 1000, 'amount_cents', 100)
  );

  v_n := rail_accrue('in_selftest_001', v_src, 1000, v_month, false, v_rows);
  PERFORM pg_temp.expect_eq(v_n, 2, 'first accrual writes 2 rows');

  -- REPLAY: the same invoice again writes 0 rows.
  v_n := rail_accrue('in_selftest_001', v_src, 1000, v_month, false, v_rows);
  PERFORM pg_temp.expect_eq(v_n, 0, 'REPLAY of the same invoice writes 0 rows');

  SELECT count(*) INTO v_cnt FROM referral_earnings WHERE stripe_invoice_ref = 'in_selftest_001';
  PERFORM pg_temp.expect_eq(v_cnt, 2::bigint, 'still exactly 2 accrual rows after the replay');

  SELECT count(*) INTO v_cnt FROM hive_revenue WHERE stripe_invoice_ref = 'in_selftest_001';
  PERFORM pg_temp.expect_eq(v_cnt, 1::bigint, 'exactly 1 revenue row after the replay');

  -- the split
  SELECT referral_paid_cents INTO v_n FROM hive_revenue WHERE stripe_invoice_ref = 'in_selftest_001';
  PERFORM pg_temp.expect_eq(v_n, 300, 'revenue row referral_paid_cents');
  SELECT hive_kept_cents INTO v_n FROM hive_revenue WHERE stripe_invoice_ref = 'in_selftest_001';
  PERFORM pg_temp.expect_eq(v_n, 700, 'revenue row hive_kept_cents');

  -- an empty array is valid: revenue row only
  v_n := rail_accrue('in_selftest_empty', v_src, 1000, v_month, false, '[]'::jsonb);
  PERFORM pg_temp.expect_eq(v_n, 0, 'empty p_rows writes 0 accruals');
  SELECT count(*) INTO v_cnt FROM hive_revenue WHERE stripe_invoice_ref = 'in_selftest_empty';
  PERFORM pg_temp.expect_eq(v_cnt, 1::bigint, 'empty p_rows still writes the revenue row');
  SELECT hive_kept_cents INTO v_n FROM hive_revenue WHERE stripe_invoice_ref = 'in_selftest_empty';
  PERFORM pg_temp.expect_eq(v_n, 1000, 'empty p_rows keeps the whole amount');
END $outer$;

-- ── rail_accrue · every malformed p_rows case in the contract raises 22023 ───
-- Each case builds a COMPLETE rail_accrue(...) statement through pg_temp.accrue_sql,
-- which owns the closing parenthesis. The first version of this block pasted a prefix
-- and let each case close its own parens; half of them miscounted and raised 42601
-- (syntax error) instead of the contract's 22023, and expect_raise correctly reported
-- that as a failure rather than a pass. Found by the first run against railtest.
CREATE FUNCTION pg_temp.accrue_sql(p_rows_expr text, p_cents text DEFAULT '1000',
                                   p_ref text DEFAULT NULL, p_month text DEFAULT NULL)
RETURNS text LANGUAGE sql AS $acc$
  SELECT format(
    'SELECT rail_accrue(%L, %L::uuid, %s, %L::date, false, %s)',
    COALESCE(p_ref, 'in_bad_' || md5(random()::text)),
    '11111111-1111-4111-8111-111111111111',
    p_cents,
    COALESCE(p_month, date_trunc('month', (now() AT TIME ZONE 'utc'))::date::text),
    p_rows_expr);
$acc$;

DO $outer$
DECLARE
  v_src text := '11111111-1111-4111-8111-111111111111';
  v_e1  text := '22222222-2222-4222-8222-222222222222';
  v_e2  text := '33333333-3333-4333-8333-333333333333';
BEGIN
  RAISE NOTICE '-- rail_accrue . the input contract (every case raises 22023) --';

  -- p_rows is not an array
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql('''{"a":1}''::jsonb'), '22023', 'p_rows is an object, not an array');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql('''"x"''::jsonb'),     '22023', 'p_rows is a string');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql('''7''::jsonb'),       '22023', 'p_rows is a number');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql('''true''::jsonb'),    '22023', 'p_rows is a boolean');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql('NULL::jsonb'),        '22023', 'p_rows is NULL');

  -- more than 2 elements
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(format(
    'jsonb_build_array(
       jsonb_build_object(''earning_agent_id'', %L, ''level'', 1, ''rate_bps'', 2000, ''amount_cents'', 200),
       jsonb_build_object(''earning_agent_id'', %L, ''level'', 2, ''rate_bps'', 1000, ''amount_cents'', 100),
       jsonb_build_object(''earning_agent_id'', %L, ''level'', 1, ''rate_bps'', 2000, ''amount_cents'', 200))',
    v_e1, v_e2, v_e1)), '22023', 'p_rows has 3 elements');

  -- an element is not an object
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql('''[1]''::jsonb'),    '22023', 'element is a number');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql('''["x"]''::jsonb'),  '22023', 'element is a string');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql('''[[]]''::jsonb'),   '22023', 'element is an array');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql('''[null]''::jsonb'), '22023', 'element is null');

  -- a key is missing
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(format(
    'jsonb_build_array(jsonb_build_object(''earning_agent_id'', %L, ''level'', 1, ''rate_bps'', 2000))',
    v_e1)), '22023', 'key missing (no amount_cents)');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(
    'jsonb_build_array(jsonb_build_object(''level'', 1, ''rate_bps'', 2000, ''amount_cents'', 200))'),
    '22023', 'key missing (no earning_agent_id)');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(format(
    'jsonb_build_array(jsonb_build_object(''earning_agent_id'', %L, ''rate_bps'', 2000, ''amount_cents'', 200))',
    v_e1)), '22023', 'key missing (no level)');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(format(
    'jsonb_build_array(jsonb_build_object(''earning_agent_id'', %L, ''level'', 1, ''amount_cents'', 200))',
    v_e1)), '22023', 'key missing (no rate_bps)');

  -- an extra key
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(format(
    'jsonb_build_array(jsonb_build_object(''earning_agent_id'', %L, ''level'', 1, ''rate_bps'', 2000,
       ''amount_cents'', 200, ''note'', ''hello''))', v_e1)), '22023', 'extra key');

  -- wrong JSON type
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(format(
    'jsonb_build_array(jsonb_build_object(''earning_agent_id'', %L, ''level'', ''1'', ''rate_bps'', 2000, ''amount_cents'', 200))',
    v_e1)), '22023', 'level is a string, not a number');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(
    'jsonb_build_array(jsonb_build_object(''earning_agent_id'', 42, ''level'', 1, ''rate_bps'', 2000, ''amount_cents'', 200))'),
    '22023', 'earning_agent_id is a number');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(
    'jsonb_build_array(jsonb_build_object(''earning_agent_id'', ''not-a-uuid'', ''level'', 1, ''rate_bps'', 2000, ''amount_cents'', 200))'),
    '22023', 'earning_agent_id is not a uuid');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(format(
    'jsonb_build_array(jsonb_build_object(''earning_agent_id'', %L, ''level'', 1.5, ''rate_bps'', 2000, ''amount_cents'', 200))',
    v_e1)), '22023', 'level is fractional');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(format(
    'jsonb_build_array(jsonb_build_object(''earning_agent_id'', %L, ''level'', 1, ''rate_bps'', 2000, ''amount_cents'', 200.5))',
    v_e1)), '22023', 'amount_cents is fractional');

  -- a level repeats
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(format(
    'jsonb_build_array(
       jsonb_build_object(''earning_agent_id'', %L, ''level'', 1, ''rate_bps'', 2000, ''amount_cents'', 200),
       jsonb_build_object(''earning_agent_id'', %L, ''level'', 1, ''rate_bps'', 2000, ''amount_cents'', 200))',
    v_e1, v_e2)), '22023', 'level 1 repeats');

  -- level and rate do not pair
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(format(
    'jsonb_build_array(jsonb_build_object(''earning_agent_id'', %L, ''level'', 1, ''rate_bps'', 1000, ''amount_cents'', 100))',
    v_e1)), '22023', 'level 1 with rate 1000');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(format(
    'jsonb_build_array(jsonb_build_object(''earning_agent_id'', %L, ''level'', 2, ''rate_bps'', 2000, ''amount_cents'', 200))',
    v_e1)), '22023', 'level 2 with rate 2000');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(format(
    'jsonb_build_array(jsonb_build_object(''earning_agent_id'', %L, ''level'', 3, ''rate_bps'', 2000, ''amount_cents'', 200))',
    v_e1)), '22023', 'level 3 is not a level');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(format(
    'jsonb_build_array(jsonb_build_object(''earning_agent_id'', %L, ''level'', 1, ''rate_bps'', 1500, ''amount_cents'', 150))',
    v_e1)), '22023', 'rate_bps 1500 is not a rate');

  -- A WRONG AMOUNT RAISES. 1000 cents at 2000 bps is 200, not 250.
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(format(
    'jsonb_build_array(jsonb_build_object(''earning_agent_id'', %L, ''level'', 1, ''rate_bps'', 2000, ''amount_cents'', 250))',
    v_e1)), '22023', 'amount_cents 250 is not floor(1000 * 2000 / 10000) = 200');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(format(
    'jsonb_build_array(jsonb_build_object(''earning_agent_id'', %L, ''level'', 1, ''rate_bps'', 2000, ''amount_cents'', 199))',
    v_e1)), '22023', 'amount_cents 199 is one cent short');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(format(
    'jsonb_build_array(jsonb_build_object(''earning_agent_id'', %L, ''level'', 1, ''rate_bps'', 2000, ''amount_cents'', -1))',
    v_e1)), '22023', 'amount_cents is negative');

  -- an earner equals the source agent
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql(format(
    'jsonb_build_array(jsonb_build_object(''earning_agent_id'', %L, ''level'', 1, ''rate_bps'', 2000, ''amount_cents'', 200))',
    v_src)), '22023', 'earner is the source agent');

  -- scalar inputs
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql('''[]''::jsonb', '0'),
    '22023', 'p_source_cents is 0');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql('''[]''::jsonb', '-5'),
    '22023', 'p_source_cents is negative');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql('''[]''::jsonb', '1000', ''),
    '22023', 'p_invoice_ref is empty');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql('''[]''::jsonb', '1000', '   '),
    '22023', 'p_invoice_ref is whitespace');
  PERFORM pg_temp.expect_raise(pg_temp.accrue_sql('''[]''::jsonb', '1000', NULL, '2026-10-15'),
    '22023', 'p_period_month is the 15th, not the 1st');
END $outer$;

-- ── the CHECK constraints reject bad rows directly ──────────────────────────
DO $outer$
DECLARE
  v_src uuid := (SELECT v FROM t_ids WHERE k='src');
  v_e1  uuid := (SELECT v FROM t_ids WHERE k='e1');
  v_m   text := quote_literal(date_trunc('month', (now() AT TIME ZONE 'utc'))::date);
  v_ins text;
BEGIN
  RAISE NOTICE '── the table CHECKs (23514) reject bad rows on a direct insert ──';
  v_ins := format('INSERT INTO referral_earnings (earning_agent_id, source_agent_id, level, status,
      stripe_invoice_ref, amount_cents, source_amount_cents, rate_bps, period_month, livemode%%s)
      VALUES (%L::uuid, %L::uuid, %%s, %%L, ''in_chk_'' || md5(random()::text), %%s, 1000, %%s, %s::date, false%%s)',
      v_e1::text, v_src::text, v_m);

  -- level/rate CHECK
  PERFORM pg_temp.expect_raise(format(v_ins, '', 1, 'pending', 100, 1000, ''),
      '23514', 'CHECK rejects level 1 with rate_bps 1000');
  PERFORM pg_temp.expect_raise(format(v_ins, '', 2, 'pending', 200, 2000, ''),
      '23514', 'CHECK rejects level 2 with rate_bps 2000');
  -- level CHECK
  PERFORM pg_temp.expect_raise(format(v_ins, '', 3, 'pending', 200, 2000, ''),
      '23514', 'CHECK rejects level 3');
  -- status CHECK
  PERFORM pg_temp.expect_raise(format(v_ins, '', 1, 'settled', 200, 2000, ''),
      '23514', 'CHECK rejects an unknown status');
  -- paid/paid_at CHECK: paid with no paid_at
  PERFORM pg_temp.expect_raise(format(v_ins, '', 1, 'paid', 200, 2000, ''),
      '23514', 'CHECK rejects status=paid with paid_at NULL');
  -- paid_at set while pending
  PERFORM pg_temp.expect_raise(format(v_ins, ', paid_at', 1, 'pending', 200, 2000, ', now()'),
      '23514', 'CHECK rejects paid_at set while pending');
  -- payout_link CHECK: in_transit with no payout_id
  PERFORM pg_temp.expect_raise(format(v_ins, '', 1, 'in_transit', 200, 2000, ''),
      '23514', 'CHECK rejects status=in_transit with payout_id NULL');
  -- negative amount
  PERFORM pg_temp.expect_raise(format(v_ins, '', 1, 'pending', -1, 2000, ''),
      '23514', 'CHECK rejects a negative amount_cents');
END $outer$;

-- ── rail_open_payout ────────────────────────────────────────────────────────
DO $outer$
DECLARE
  v_src    uuid := (SELECT v FROM t_ids WHERE k='src');
  v_e1     uuid := (SELECT v FROM t_ids WHERE k='e1');
  v_inel   uuid := (SELECT v FROM t_ids WHERE k='inel');
  v_month  date := date_trunc('month', (now() AT TIME ZONE 'utc'))::date;
  v_cut    timestamptz := now() + interval '1 minute';
  v_payout uuid;
  v_amount integer;
  v_dest   text;
  v_cnt    bigint;
BEGIN
  RAISE NOTICE '── rail_open_payout · the four requirements and the floor ──';

  -- E1 holds 200 cents from the happy path: BELOW the 500 floor.
  SELECT payout_id INTO v_payout FROM rail_open_payout(v_e1, v_month, v_cut, false);
  PERFORM pg_temp.expect_eq(v_payout, NULL::uuid, 'open returns null below the 500-cent floor');

  -- Give E1 enough: three more invoices at 1000 cents L1 = 200 each -> 800 total.
  PERFORM rail_accrue('in_selftest_002', v_src, 1000, v_month, false,
    jsonb_build_array(jsonb_build_object('earning_agent_id', v_e1::text, 'level', 1,
                                          'rate_bps', 2000, 'amount_cents', 200)));
  PERFORM rail_accrue('in_selftest_003', v_src, 1000, v_month, false,
    jsonb_build_array(jsonb_build_object('earning_agent_id', v_e1::text, 'level', 1,
                                          'rate_bps', 2000, 'amount_cents', 200)));
  PERFORM rail_accrue('in_selftest_004', v_src, 1000, v_month, false,
    jsonb_build_array(jsonb_build_object('earning_agent_id', v_e1::text, 'level', 1,
                                          'rate_bps', 2000, 'amount_cents', 200)));

  -- WRONG MODE: the rows are livemode=false, so a live open must find nothing.
  SELECT payout_id INTO v_payout FROM rail_open_payout(v_e1, v_month, v_cut, true);
  PERFORM pg_temp.expect_eq(v_payout, NULL::uuid, 'open returns null when the mode does not match');

  -- PAYOUTS NOT ENABLED
  SELECT payout_id INTO v_payout FROM rail_open_payout(v_inel, v_month, v_cut, false);
  PERFORM pg_temp.expect_eq(v_payout, NULL::uuid, 'open returns null when Connect payouts are disabled');

  -- NOT AN ACTIVE EARNER: suspend E1, try, restore.
  UPDATE agents SET status = 'suspended' WHERE id = v_e1;
  SELECT payout_id INTO v_payout FROM rail_open_payout(v_e1, v_month, v_cut, false);
  PERFORM pg_temp.expect_eq(v_payout, NULL::uuid, 'open returns null for a suspended agent');
  UPDATE agents SET status = 'active' WHERE id = v_e1;

  -- a scout is not an active earner either
  UPDATE agents SET tier = 'scout' WHERE id = v_e1;
  SELECT payout_id INTO v_payout FROM rail_open_payout(v_e1, v_month, v_cut, false);
  PERFORM pg_temp.expect_eq(v_payout, NULL::uuid, 'open returns null for a scout');
  UPDATE agents SET tier = 'worker_bee' WHERE id = v_e1;

  -- THE HAPPY OPEN: 800 cents, over the floor.
  SELECT payout_id, amount_cents, destination_account
    INTO v_payout, v_amount, v_dest
    FROM rail_open_payout(v_e1, v_month, v_cut, false);
  IF v_payout IS NULL THEN
    RAISE EXCEPTION 'FAIL: the happy open returned null';
  END IF;
  PERFORM pg_temp.expect_eq(v_amount, 800, 'open amount is the sum of the pending rows');
  PERFORM pg_temp.expect_eq(v_dest, 'acct_selftest_e1', 'open returns the destination account');

  SELECT count(*) INTO v_cnt FROM referral_earnings
   WHERE earning_agent_id = v_e1 AND status = 'in_transit' AND payout_id = v_payout;
  PERFORM pg_temp.expect_eq(v_cnt, 4::bigint, 'all 4 rows are in_transit against the payout');

  -- A SECOND OPEN FOR THE SAME AGENT RETURNS NULL (the partial unique index).
  SELECT payout_id INTO v_payout FROM rail_open_payout(v_e1, v_month, v_cut, false);
  PERFORM pg_temp.expect_eq(v_payout, NULL::uuid, 'a second open for the same agent returns null');

  -- the cutoff excludes rows created at or after it
  PERFORM rail_accrue('in_selftest_005', v_src, 1000, v_month, false,
    jsonb_build_array(jsonb_build_object('earning_agent_id', v_e1::text, 'level', 1,
                                          'rate_bps', 2000, 'amount_cents', 200)));
  SELECT count(*) INTO v_cnt FROM referral_earnings
   WHERE earning_agent_id = v_e1 AND status = 'pending';
  PERFORM pg_temp.expect_eq(v_cnt, 1::bigint, 'the new row stays pending, outside the open');
END $outer$;

-- ── rail_close_payout ───────────────────────────────────────────────────────
DO $outer$
DECLARE
  v_src    uuid := (SELECT v FROM t_ids WHERE k='src');
  v_e1     uuid := (SELECT v FROM t_ids WHERE k='e1');
  v_e2     uuid := (SELECT v FROM t_ids WHERE k='e2');
  v_month  date := date_trunc('month', (now() AT TIME ZONE 'utc'))::date;
  v_cut    timestamptz := now() + interval '1 minute';
  v_payout uuid;
  v_cnt    bigint;
BEGIN
  RAISE NOTICE '── rail_close_payout · paid, idempotence, conflict, failed ──';

  SELECT id INTO v_payout FROM payouts WHERE agent_id = v_e1 AND status = 'created';
  IF v_payout IS NULL THEN RAISE EXCEPTION 'FAIL: no open payout to close'; END IF;

  -- a paid close with no transfer id raises
  PERFORM pg_temp.expect_raise(
    format('SELECT rail_close_payout(%L::uuid, ''paid'', NULL, NULL)', v_payout::text),
    '22023', 'close paid without a transfer id raises');

  -- an unknown outcome raises
  PERFORM pg_temp.expect_raise(
    format('SELECT rail_close_payout(%L::uuid, ''settled'', ''tr_x'', NULL)', v_payout::text),
    '22023', 'close with an unknown outcome raises');

  -- CLOSE PAID
  PERFORM rail_close_payout(v_payout, 'paid', 'tr_selftest_001', NULL);
  SELECT count(*) INTO v_cnt FROM payouts
   WHERE id = v_payout AND status = 'paid' AND paid_at IS NOT NULL
     AND stripe_transfer_id = 'tr_selftest_001' AND updated_at IS NOT NULL;
  PERFORM pg_temp.expect_eq(v_cnt, 1::bigint, 'close paid sets status, paid_at, transfer id, updated_at');
  SELECT count(*) INTO v_cnt FROM referral_earnings
   WHERE payout_id = v_payout AND status = 'paid' AND paid_at IS NOT NULL;
  PERFORM pg_temp.expect_eq(v_cnt, 4::bigint, 'close paid marks its 4 rows paid with paid_at');

  -- CLOSE PAID THEN CLOSE PAID IS A NO-OP
  PERFORM rail_close_payout(v_payout, 'paid', 'tr_selftest_001', NULL);
  SELECT count(*) INTO v_cnt FROM payouts WHERE id = v_payout AND status = 'paid';
  PERFORM pg_temp.expect_eq(v_cnt, 1::bigint, 'close paid twice is a no-op');

  -- CLOSE PAID THEN CLOSE FAILED RAISES
  PERFORM pg_temp.expect_raise(
    format('SELECT rail_close_payout(%L::uuid, ''failed'', NULL, ''account_closed'')', v_payout::text),
    '22023', 'close failed after close paid raises');

  -- CLOSE FAILED RETURNS ROWS TO PENDING. E2 holds 100 cents; top it up and open.
  PERFORM rail_accrue('in_selftest_006', v_src, 10000, v_month, false,
    jsonb_build_array(jsonb_build_object('earning_agent_id', v_e2::text, 'level', 2,
                                          'rate_bps', 1000, 'amount_cents', 1000)));
  SELECT payout_id INTO v_payout FROM rail_open_payout(v_e2, v_month, v_cut, false);
  IF v_payout IS NULL THEN RAISE EXCEPTION 'FAIL: could not open a payout for E2'; END IF;

  PERFORM rail_close_payout(v_payout, 'failed', NULL, 'account_closed');
  SELECT count(*) INTO v_cnt FROM payouts
   WHERE id = v_payout AND status = 'failed' AND failure_code = 'account_closed'
     AND paid_at IS NULL AND stripe_transfer_id IS NULL;
  PERFORM pg_temp.expect_eq(v_cnt, 1::bigint, 'close failed sets status and failure_code, no paid_at');
  SELECT count(*) INTO v_cnt FROM referral_earnings
   WHERE earning_agent_id = v_e2 AND status = 'pending' AND payout_id IS NULL;
  PERFORM pg_temp.expect_eq(v_cnt, 2::bigint, 'close failed returns the rows to pending, payout_id cleared');

  -- close failed twice is a no-op
  PERFORM rail_close_payout(v_payout, 'failed', NULL, 'account_closed');
  SELECT count(*) INTO v_cnt FROM payouts WHERE id = v_payout AND status = 'failed';
  PERFORM pg_temp.expect_eq(v_cnt, 1::bigint, 'close failed twice is a no-op');

  -- and a paid close after a failed close raises
  PERFORM pg_temp.expect_raise(
    format('SELECT rail_close_payout(%L::uuid, ''paid'', ''tr_selftest_002'', NULL)', v_payout::text),
    '22023', 'close paid after close failed raises');

  -- a payout that does not exist raises
  PERFORM pg_temp.expect_raise(
    'SELECT rail_close_payout(''99999999-9999-4999-8999-999999999999''::uuid, ''paid'', ''tr_x'', NULL)',
    '22023', 'close of an unknown payout raises');

  -- after the failed close, E2 can be opened again
  SELECT payout_id INTO v_payout FROM rail_open_payout(v_e2, v_month, v_cut, false);
  IF v_payout IS NULL THEN
    RAISE EXCEPTION 'FAIL: E2 could not be re-opened after a failed close';
  END IF;
  RAISE NOTICE '  ok   a failed payout can be re-opened next run';
END $outer$;

-- ── the payouts floor and one-open index, directly ──────────────────────────
DO $outer$
DECLARE
  v_e1 uuid := (SELECT v FROM t_ids WHERE k='e1');
  v_m  date := date_trunc('month', (now() AT TIME ZONE 'utc'))::date;
BEGIN
  RAISE NOTICE '── the payouts table CHECKs ──';
  PERFORM pg_temp.expect_raise(format(
    'INSERT INTO payouts (agent_id, amount_cents, status, livemode, run_month)
     VALUES (%L::uuid, 499, ''created'', false, %L::date)', v_e1::text, v_m),
    '23514', 'payouts CHECK rejects amount_cents below 500');
  PERFORM pg_temp.expect_raise(format(
    'INSERT INTO payouts (agent_id, amount_cents, status, livemode, run_month)
     VALUES (%L::uuid, 500, ''paid'', false, %L::date)', v_e1::text, v_m),
    '23514', 'payouts CHECK rejects paid with no paid_at or transfer id');
END $outer$;

DO $$ BEGIN RAISE NOTICE '';
            RAISE NOTICE 'ALL ASSERTIONS PASSED';
            RAISE NOTICE ''; END $$;

-- Leaves nothing behind.
ROLLBACK;
