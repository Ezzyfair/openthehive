-- 20261013_rail_m1.sql
-- ----------------------------------------------------------------------------
-- THE HIVE — payout rail migration M1. RAIL-DESIGN-v1.1 §4.1-§4.7.
-- Design sha256 21cff4b4d85cee6af03660effda68111dbcd5862d89f8cf60701ba76490df3f9,
-- PASSed by Nikita Oct 12 2026. Ticket NIK-RAIL-002.
--
-- ONE TRANSACTION. Rollback is the sibling file 20261013_rail_m1_rollback.sql.
-- NOT RUN BY THIS SESSION: nothing here was executed against any database.
--
-- ORDER, and why it is this order:
--   1  payouts            — referral_earnings.payout_id references it, so it exists first
--   2  rail_legacy_rows + guard + archive + deletes (§4.4)
--                         — the ledger is emptied BEFORE any NOT NULL or CHECK is added,
--                           which is what lets those constraints be added without a
--                           backfill and without weakening them for a pre-v1.3 row
--   3  referral_earnings  — columns, NOT NULLs, CHECKs, UNIQUE; wallet_address dropped
--   4  hive_revenue       — columns NOT NULL + UNIQUE (table is empty by step 2)
--   5  agents             — Connect columns
--   6  payout_notices
--   7  RLS and REVOKEs
--   8  the three functions
--
-- Every date and timestamp is computed in UTC. No statement depends on the session
-- TimeZone: now() is timestamptz (an absolute instant), and every date is derived with
-- an explicit AT TIME ZONE 'utc'.
-- ----------------------------------------------------------------------------
BEGIN;

-- ============================================================================
-- 1 · payouts (§4.3)
-- ============================================================================
CREATE TABLE payouts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id           uuid NOT NULL REFERENCES agents(id),
  amount_cents       integer NOT NULL CHECK (amount_cents >= 500),
  status             text NOT NULL CHECK (status IN ('created','paid','failed')),
  stripe_transfer_id text UNIQUE,
  livemode           boolean NOT NULL,
  run_month          date NOT NULL,
  failure_code       text,
  paid_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payouts_paid_iff_transfer
    CHECK ((status = 'paid') = (paid_at IS NOT NULL AND stripe_transfer_id IS NOT NULL))
);

-- The id is also the Stripe Idempotency-Key and the transfer_group, so a retry of the
-- same payout cannot create a second transfer.
COMMENT ON COLUMN payouts.id IS
  'Also the Stripe Idempotency-Key and transfer_group for this payout (RAIL-DESIGN-v1.1 §4.3).';
-- run_month is the UTC month the payout was OPENED and is never changed, whenever it
-- settles (M4). updated_at is set explicitly by rail_close_payout; there is no trigger (L1).
COMMENT ON COLUMN payouts.run_month IS
  'UTC month the payout was opened. Never changed on settlement (§4.3, M4).';

CREATE UNIQUE INDEX payouts_one_open_per_agent ON payouts (agent_id) WHERE status = 'created';

-- ============================================================================
-- 2 · the legacy archive, the guard, and emptying the ledger (§4.4, ruling R-F)
-- ============================================================================
-- Existing rows are ARCHIVED, NOT BACKFILLED. The Aug row pairs level 1 with 10%, which
-- the new CHECKs rightly forbid; bending a constraint to admit a pre-v1.3 row would
-- weaken it for every later row. No value is coerced or converted.
CREATE TABLE rail_legacy_rows (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_table text NOT NULL,
  row_id      uuid NOT NULL UNIQUE,
  row         jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rail_legacy_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON rail_legacy_rows FROM anon, authenticated;
-- F3 · the IDENTITY SEQUENCE too. REVOKE on a table does not reach the sequence behind
-- its GENERATED ALWAYS AS IDENTITY column, and USAGE on a sequence lets a role call
-- nextval and currval — enough to read how many rows have been archived and to burn ids.
REVOKE ALL ON SEQUENCE rail_legacy_rows_id_seq FROM anon, authenticated;

-- The guard aborts M1, changing nothing, if the ledger is not exactly the four rows
-- measured on Oct 11. A fifth row means the measurement is stale and a human must look.
DO $$ BEGIN
  IF (SELECT count(*) FROM referral_earnings) <> 2
     OR (SELECT count(*) FROM referral_earnings WHERE id IN
         ('4bf22c8a-0aab-4f23-ac95-ae4678b5d11e','a146711d-bb62-49b7-81a4-485f7652544a')) <> 2
     OR (SELECT count(*) FROM hive_revenue) <> 2
     OR (SELECT count(*) FROM hive_revenue WHERE id IN
         ('9ecd2b43-5b9e-450c-bcf6-3093d91940e2','ab45343e-2b11-4ccd-804b-11e9448dbc28')) <> 2
  THEN RAISE EXCEPTION 'rail M1: ledger is not the four known legacy rows; stop and re-measure';
  END IF;
END $$;

INSERT INTO rail_legacy_rows (source_table, row_id, row)
  SELECT 'referral_earnings', r.id, to_jsonb(r) FROM referral_earnings r;
INSERT INTO rail_legacy_rows (source_table, row_id, row)
  SELECT 'hive_revenue', h.id, to_jsonb(h) FROM hive_revenue h;
DELETE FROM referral_earnings;
DELETE FROM hive_revenue;

-- ============================================================================
-- 3 · referral_earnings (§4.2)
-- ============================================================================
ALTER TABLE referral_earnings
  ADD COLUMN stripe_invoice_ref  text,
  ADD COLUMN amount_cents        integer,
  ADD COLUMN source_amount_cents integer,
  ADD COLUMN rate_bps            integer,
  ADD COLUMN period_month        date,
  ADD COLUMN livemode            boolean,
  ADD COLUMN payout_id           uuid REFERENCES payouts(id),
  ADD COLUMN reversed_at         timestamptz,
  ADD COLUMN reversal_reason     text;

-- The table is empty (step 2), so NOT NULL needs no backfill and no default.
ALTER TABLE referral_earnings
  ALTER COLUMN stripe_invoice_ref  SET NOT NULL,
  ALTER COLUMN amount_cents        SET NOT NULL,
  ALTER COLUMN source_amount_cents SET NOT NULL,
  ALTER COLUMN rate_bps            SET NOT NULL,
  ALTER COLUMN period_month        SET NOT NULL,
  ALTER COLUMN livemode            SET NOT NULL,
  ALTER COLUMN earning_agent_id    SET NOT NULL,
  ALTER COLUMN source_agent_id     SET NOT NULL,
  ALTER COLUMN level               SET NOT NULL,
  ALTER COLUMN status              SET NOT NULL,
  -- F5 · created_at is the cutoff rail_open_payout filters on (created_at < p_cutoff).
  -- A NULL there makes the row invisible to every payout run forever, silently. It has
  -- a DEFAULT now(), so NOT NULL only closes the case where a caller passes NULL
  -- explicitly.
  ALTER COLUMN created_at          SET NOT NULL;

-- 'in_…' for invoices, 'pi_…' for one-time payments.
COMMENT ON COLUMN referral_earnings.stripe_invoice_ref IS
  'Stripe invoice (in_…) or payment intent (pi_…) this accrual derives from (§4.2).';
COMMENT ON COLUMN referral_earnings.period_month IS
  'First day of the invoice PERIOD''s month, taken from Stripe and not from the server clock (D4).';
COMMENT ON COLUMN referral_earnings.paid_at IS
  'Pre-existing column, retained (B1). Written only by rail_close_payout.';

ALTER TABLE referral_earnings
  ADD CONSTRAINT referral_earnings_invoice_level_uniq UNIQUE (stripe_invoice_ref, level),
  ADD CONSTRAINT referral_earnings_status_chk  CHECK (status IN ('pending','in_transit','paid','reversed')),
  ADD CONSTRAINT referral_earnings_level_chk    CHECK (level IN (1, 2)),
  ADD CONSTRAINT referral_earnings_amount_chk   CHECK (amount_cents >= 0),
  ADD CONSTRAINT referral_earnings_source_amount_chk CHECK (source_amount_cents > 0),
  ADD CONSTRAINT referral_earnings_rate_chk     CHECK (rate_bps IN (2000, 1000)),
  ADD CONSTRAINT referral_earnings_payout_link_chk
    CHECK ((status IN ('in_transit','paid')) = (payout_id IS NOT NULL)),
  ADD CONSTRAINT referral_earnings_level_rate_chk
    CHECK ((level = 1 AND rate_bps = 2000) OR (level = 2 AND rate_bps = 1000)),
  ADD CONSTRAINT referral_earnings_paid_at_chk
    CHECK ((status = 'paid') = (paid_at IS NOT NULL));

-- UNIQUE (stripe_invoice_ref, level) IS the idempotency gate: one invoice can produce at
-- most one L1 row and one L2 row, whatever is delivered and however often (closes D3).
COMMENT ON CONSTRAINT referral_earnings_invoice_level_uniq ON referral_earnings IS
  'Idempotency gate: one invoice yields at most one L1 and one L2 accrual (§4.2, closes D3).';

-- F4 · the two indexes the rail actually reads by.
--   (earning_agent_id, status) — rail_open_payout step (3) and every balance read.
--   (payout_id)                — rail_close_payout updates every row of one payout, and
--                                the FK to payouts has no index of its own, so a delete
--                                or an update of a payout row would seq-scan the ledger.
CREATE INDEX referral_earnings_earner_status_idx ON referral_earnings (earning_agent_id, status);
CREATE INDEX referral_earnings_payout_idx        ON referral_earnings (payout_id);

-- wallet_address is DROPPED: a copy of eth_wallet on a money row, meaningless under
-- ruling 10. The legacy numeric columns (earned_amount, subscription_amount, percentage,
-- subscription_month) STAY for one deploy window, written and read by nothing after the
-- cutover commit, and are dropped in M2.
ALTER TABLE referral_earnings DROP COLUMN wallet_address;

-- ============================================================================
-- 4 · hive_revenue (§4.4)
-- ============================================================================
-- The design's §4.4 column list gives no nullability; this ticket rules them NOT NULL
-- with UNIQUE (stripe_invoice_ref) because step 2 leaves the table empty. Where the
-- design and the ticket disagree the design wins — here they do not disagree, the
-- ticket only resolves what §4.4 left open.
ALTER TABLE hive_revenue
  ADD COLUMN stripe_invoice_ref  text,
  ADD COLUMN source_amount_cents integer,
  ADD COLUMN referral_paid_cents integer,
  ADD COLUMN hive_kept_cents     integer,
  ADD COLUMN livemode            boolean;

ALTER TABLE hive_revenue
  ALTER COLUMN stripe_invoice_ref  SET NOT NULL,
  ALTER COLUMN source_amount_cents SET NOT NULL,
  ALTER COLUMN referral_paid_cents SET NOT NULL,
  ALTER COLUMN hive_kept_cents     SET NOT NULL,
  ALTER COLUMN livemode            SET NOT NULL;

ALTER TABLE hive_revenue
  ADD CONSTRAINT hive_revenue_invoice_uniq UNIQUE (stripe_invoice_ref),
  ADD CONSTRAINT hive_revenue_source_amount_chk CHECK (source_amount_cents > 0),
  ADD CONSTRAINT hive_revenue_referral_paid_chk CHECK (referral_paid_cents >= 0),
  ADD CONSTRAINT hive_revenue_kept_chk          CHECK (hive_kept_cents >= 0),
  ADD CONSTRAINT hive_revenue_split_chk
    CHECK (referral_paid_cents + hive_kept_cents = source_amount_cents);

-- ============================================================================
-- 5 · agents — Connect columns (§4.1)
-- ============================================================================
-- eth_wallet is KEPT (ruling 9). strike_username is left in place and unread; its
-- removal is a chore, not rail work.
ALTER TABLE agents
  ADD COLUMN stripe_connect_account_id text UNIQUE,
  ADD COLUMN connect_payouts_enabled   boolean NOT NULL DEFAULT false,
  ADD COLUMN connect_details_submitted boolean NOT NULL DEFAULT false,
  ADD COLUMN stripe_requirements_json  jsonb,
  ADD COLUMN connect_livemode          boolean,
  ADD COLUMN connect_updated_at        timestamptz;

COMMENT ON COLUMN agents.connect_livemode IS
  'The Stripe mode the Connect account was created in. A test account never pays a live payout (§4.1).';

-- ============================================================================
-- 6 · payout_notices (§4.5)
-- ============================================================================
CREATE TABLE payout_notices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      uuid NOT NULL REFERENCES agents(id),
  kind          text NOT NULL CHECK (kind IN ('earned','held','payout_sent','payout_failed')),
  period_month  date NOT NULL,
  balance_cents integer NOT NULL CHECK (balance_cents >= 0),
  email_send_id uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_notices_one_per_kind_month UNIQUE (agent_id, kind, period_month)
);

-- ============================================================================
-- 7 · grants and RLS (§4.6)
-- ============================================================================
REVOKE ALL ON referral_earnings, hive_revenue, payouts, payout_notices,
                rail_legacy_rows, members, agents, stripe_events
  FROM anon, authenticated;

-- Neither is a path around the fence: bump_pollen_on_transaction returns trigger and
-- cannot be called as an RPC; reset_premium_tokens_if_due is not SECURITY DEFINER and is
-- called only by a service-role client (§4.6, read Oct 12).
REVOKE EXECUTE ON FUNCTION reset_premium_tokens_if_due FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION bump_pollen_on_transaction  FROM anon, authenticated, PUBLIC;

ALTER TABLE payouts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE payout_notices ENABLE ROW LEVEL SECURITY;

-- public_agent_cards is NOT touched: it is a view owned by postgres with reloptions
-- null, so it is not security_invoker and runs with its owner's rights. anon keeps
-- SELECT on the view and on nothing beneath it (§4.6).

-- ============================================================================
-- 8 · the three functions (§4.7)
-- ============================================================================

-- ── rail_accrue ─────────────────────────────────────────────────────────────
-- Returns the number of accrual rows written: 0 on a replay.
--
-- The input contract (§4.7, closes B3) is enforced here and not in TypeScript, because
-- the database is the only place a check cannot be skipped by a second caller.
--
-- F1 · ONE INVOICE IS PROCESSED EXACTLY ONCE, AS A UNIT. The order below is the whole
-- point and it is not interchangeable:
--
--   1  validate EVERY element of p_rows, writing nothing;
--   2  INSERT the hive_revenue row with ON CONFLICT (stripe_invoice_ref) DO NOTHING —
--      this row is THE CLAIM on the invoice;
--   3  if that insert wrote nothing, the invoice was already processed: RETURN 0 and
--      write no accrual at all;
--   4  otherwise INSERT the accrual rows with a PLAIN INSERT, no ON CONFLICT.
--
-- The earlier version inserted each accrual with ON CONFLICT (stripe_invoice_ref, level)
-- DO NOTHING and then conflicted the revenue row away. That silently merged two
-- DIFFERENT chains for the same invoice: a replay naming a different earner at level 2
-- would have added that row beside the first one, because (invoice, level) did not
-- collide. The revenue row is now the gate, so a second delivery of the same invoice
-- cannot add, change or re-rate a single accrual — whatever chain it carries.
--
-- A plain INSERT at step 4 is deliberate: having claimed the invoice, a unique violation
-- on (stripe_invoice_ref, level) is no longer an expected replay but a real
-- contradiction, and it must abort the transaction rather than be swallowed.
CREATE FUNCTION rail_accrue(
  p_invoice_ref   text,
  p_source_agent  uuid,
  p_source_cents  integer,
  p_period_month  date,
  p_livemode      boolean,
  p_rows          jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_elem        jsonb;
  v_keys        text[];
  v_level       integer;
  v_rate        integer;
  v_amount      integer;
  v_earner      uuid;
  v_seen_levels integer[] := '{}';
  v_paid_cents  integer := 0;
  v_written     integer := 0;
  v_claimed     boolean;
BEGIN
  -- scalar inputs
  IF p_invoice_ref IS NULL OR btrim(p_invoice_ref) = '' THEN
    RAISE EXCEPTION 'rail_accrue: p_invoice_ref is required' USING ERRCODE = '22023';
  END IF;
  IF p_source_agent IS NULL THEN
    RAISE EXCEPTION 'rail_accrue: p_source_agent is required' USING ERRCODE = '22023';
  END IF;
  IF p_source_cents IS NULL OR p_source_cents <= 0 THEN
    RAISE EXCEPTION 'rail_accrue: p_source_cents must be > 0' USING ERRCODE = '22023';
  END IF;
  IF p_livemode IS NULL THEN
    RAISE EXCEPTION 'rail_accrue: p_livemode is required' USING ERRCODE = '22023';
  END IF;
  IF p_period_month IS NULL OR p_period_month <> date_trunc('month', p_period_month)::date THEN
    RAISE EXCEPTION 'rail_accrue: p_period_month must be the first day of a month'
      USING ERRCODE = '22023';
  END IF;

  -- p_rows shape
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'rail_accrue: p_rows must be a JSON array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_rows) > 2 THEN
    RAISE EXCEPTION 'rail_accrue: p_rows may hold at most 2 elements' USING ERRCODE = '22023';
  END IF;

  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    IF jsonb_typeof(v_elem) <> 'object' THEN
      RAISE EXCEPTION 'rail_accrue: every p_rows element must be an object' USING ERRCODE = '22023';
    END IF;

    -- exactly four keys, no more and no fewer
    SELECT array_agg(k ORDER BY k) INTO v_keys FROM jsonb_object_keys(v_elem) AS t(k);
    IF v_keys IS DISTINCT FROM ARRAY['amount_cents','earning_agent_id','level','rate_bps'] THEN
      RAISE EXCEPTION 'rail_accrue: element keys must be exactly earning_agent_id, level, rate_bps, amount_cents'
        USING ERRCODE = '22023';
    END IF;

    -- types. jsonb_typeof first, so a string '1' is rejected rather than coerced.
    IF jsonb_typeof(v_elem->'earning_agent_id') <> 'string'
       OR jsonb_typeof(v_elem->'level') <> 'number'
       OR jsonb_typeof(v_elem->'rate_bps') <> 'number'
       OR jsonb_typeof(v_elem->'amount_cents') <> 'number' THEN
      RAISE EXCEPTION 'rail_accrue: element key of the wrong JSON type' USING ERRCODE = '22023';
    END IF;

    BEGIN
      v_earner := (v_elem->>'earning_agent_id')::uuid;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'rail_accrue: earning_agent_id is not a uuid' USING ERRCODE = '22023';
    END;

    v_level  := (v_elem->>'level')::numeric;
    v_rate   := (v_elem->>'rate_bps')::numeric;
    v_amount := (v_elem->>'amount_cents')::numeric;

    -- integers, not fractions dressed as numbers
    IF (v_elem->>'level')::numeric <> v_level
       OR (v_elem->>'rate_bps')::numeric <> v_rate
       OR (v_elem->>'amount_cents')::numeric <> v_amount THEN
      RAISE EXCEPTION 'rail_accrue: level, rate_bps and amount_cents must be integers'
        USING ERRCODE = '22023';
    END IF;

    IF v_level NOT IN (1, 2) THEN
      RAISE EXCEPTION 'rail_accrue: level must be 1 or 2' USING ERRCODE = '22023';
    END IF;
    IF v_level = ANY (v_seen_levels) THEN
      RAISE EXCEPTION 'rail_accrue: level % repeats', v_level USING ERRCODE = '22023';
    END IF;
    v_seen_levels := v_seen_levels || v_level;

    IF NOT ((v_level = 1 AND v_rate = 2000) OR (v_level = 2 AND v_rate = 1000)) THEN
      RAISE EXCEPTION 'rail_accrue: level % does not pair with rate_bps %', v_level, v_rate
        USING ERRCODE = '22023';
    END IF;
    IF v_amount < 0 THEN
      RAISE EXCEPTION 'rail_accrue: amount_cents must be >= 0' USING ERRCODE = '22023';
    END IF;
    -- integer division floors for positive operands, which is the contract's floor().
    IF v_amount <> (p_source_cents * v_rate) / 10000 THEN
      RAISE EXCEPTION 'rail_accrue: amount_cents % is not floor(% * % / 10000)',
        v_amount, p_source_cents, v_rate USING ERRCODE = '22023';
    END IF;
    IF v_earner = p_source_agent THEN
      RAISE EXCEPTION 'rail_accrue: an earner may not be the source agent' USING ERRCODE = '22023';
    END IF;

    -- STEP 1 ONLY VALIDATES. Nothing is written until the invoice is claimed below.
    v_paid_cents := v_paid_cents + v_amount;
  END LOOP;

  IF v_paid_cents > p_source_cents THEN
    RAISE EXCEPTION 'rail_accrue: referral total % exceeds the source amount %',
      v_paid_cents, p_source_cents USING ERRCODE = '22023';
  END IF;

  -- ── step 2 · CLAIM THE INVOICE ────────────────────────────────────────────
  -- An empty array is VALID (no eligible chain) and claims the invoice with a revenue
  -- row carrying the whole amount as kept.
  -- F2 · source_agent_id is written: the revenue row records WHOSE subscription produced
  -- it, which is the only link from the colony's cut back to the paying member.
  INSERT INTO hive_revenue (
    stripe_invoice_ref, source_agent_id, source_amount_cents,
    referral_paid_cents, hive_kept_cents, livemode
  ) VALUES (
    p_invoice_ref, p_source_agent, p_source_cents,
    v_paid_cents, p_source_cents - v_paid_cents, p_livemode
  )
  ON CONFLICT (stripe_invoice_ref) DO NOTHING;

  v_claimed := FOUND;

  -- ── step 3 · a replay stops here, having written nothing ──────────────────
  IF NOT v_claimed THEN
    RETURN 0;
  END IF;

  -- ── step 4 · the accruals, PLAIN INSERT ───────────────────────────────────
  -- Re-walks the array that step 1 already validated. No ON CONFLICT: the invoice is
  -- ours, so a unique violation here is a contradiction and must abort.
  FOR v_elem IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    INSERT INTO referral_earnings (
      earning_agent_id, source_agent_id, level, status,
      stripe_invoice_ref, amount_cents, source_amount_cents, rate_bps, period_month, livemode
    ) VALUES (
      (v_elem->>'earning_agent_id')::uuid, p_source_agent,
      (v_elem->>'level')::integer, 'pending',
      p_invoice_ref, (v_elem->>'amount_cents')::integer, p_source_cents,
      (v_elem->>'rate_bps')::integer, p_period_month, p_livemode
    );
    v_written := v_written + 1;
  END LOOP;

  RETURN v_written;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION rail_accrue(text, uuid, integer, date, boolean, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION rail_accrue(text, uuid, integer, date, boolean, jsonb)
  TO service_role;

-- ── rail_open_payout ────────────────────────────────────────────────────────
-- Lock order matters and is fixed: the AGENT ROW FIRST (closes H7 — the Connect
-- webhook's account.updated UPDATE takes the same row lock, so eligibility cannot change
-- under an open), then the pending earnings.
--
-- "Active earner" here is the SQL twin of isActiveEarner in lib/referral-engine.ts:54-59:
--
--     export function isActiveEarner(a): boolean {
--       if (a.is_staff) return true;
--       if (!a.status || !ACTIVE_STATUSES.has(a.status)) return false;
--       if (a.tier === 'scout') return false;
--       return true;
--     }
--
-- with ACTIVE_STATUSES = {'active','first_flight'}. In SQL:
--     is_staff OR (status IN ('active','first_flight') AND tier IS DISTINCT FROM 'scout')
-- IS DISTINCT FROM, not <>, so a NULL tier does not swallow the row.
CREATE FUNCTION rail_open_payout(
  p_agent     uuid,
  p_run_month date,
  p_cutoff    timestamptz,
  p_livemode  boolean
) RETURNS TABLE (payout_id uuid, amount_cents integer, destination_account text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_agent   record;
  v_total   integer;
  v_ids     uuid[];
  v_payout  uuid;
BEGIN
  IF p_agent IS NULL OR p_run_month IS NULL OR p_cutoff IS NULL OR p_livemode IS NULL THEN
    RAISE EXCEPTION 'rail_open_payout: all arguments are required' USING ERRCODE = '22023';
  END IF;
  IF p_run_month <> date_trunc('month', p_run_month)::date THEN
    RAISE EXCEPTION 'rail_open_payout: p_run_month must be the first day of a month'
      USING ERRCODE = '22023';
  END IF;

  -- (1) the agent row, FOR UPDATE, before anything else is read
  SELECT id, is_staff, status, tier,
         stripe_connect_account_id, connect_payouts_enabled, connect_livemode
    INTO v_agent
    FROM agents
   WHERE id = p_agent
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- (2) eligibility
  IF NOT COALESCE(v_agent.connect_payouts_enabled, false) THEN RETURN; END IF;
  IF v_agent.stripe_connect_account_id IS NULL             THEN RETURN; END IF;
  IF v_agent.connect_livemode IS DISTINCT FROM p_livemode   THEN RETURN; END IF;
  IF NOT (COALESCE(v_agent.is_staff, false)
          OR (v_agent.status IN ('active','first_flight')
              AND v_agent.tier IS DISTINCT FROM 'scout'))  THEN RETURN; END IF;

  -- (3) that agent's pending rows, before the cutoff, in this mode.
  --
  -- EVERY column reference here is QUALIFIED. The RETURNS TABLE above makes
  -- payout_id, amount_cents and destination_account into PL/pgSQL variables, and
  -- referral_earnings has columns called payout_id and amount_cents, so an unqualified
  -- `amount_cents` is ambiguous and PostgreSQL refuses the query at RUN TIME, not at
  -- CREATE FUNCTION time. The first run against a scratch database found this on the
  -- first eligible agent; a parser-free review would not have.
  SELECT array_agg(claimed.id), COALESCE(sum(claimed.amount_cents), 0)
    INTO v_ids, v_total
    FROM (
      SELECT re.id, re.amount_cents
        FROM referral_earnings re
       WHERE re.earning_agent_id = p_agent
         AND re.status = 'pending'
         AND re.created_at < p_cutoff
         AND re.livemode = p_livemode
         FOR UPDATE SKIP LOCKED
    ) AS claimed;

  -- (4) the floor
  IF v_ids IS NULL OR v_total < 500 THEN
    RETURN;
  END IF;

  -- (5) the payout. The partial unique index payouts_one_open_per_agent makes a second
  -- open for the same agent a conflict rather than a race; DO NOTHING turns that into a
  -- null return, which is what the caller expects.
  INSERT INTO payouts (agent_id, amount_cents, status, livemode, run_month)
  VALUES (p_agent, v_total, 'created', p_livemode, p_run_month)
  ON CONFLICT (agent_id) WHERE status = 'created' DO NOTHING
  RETURNING id INTO v_payout;

  IF v_payout IS NULL THEN
    RETURN;
  END IF;

  -- (6) claim the rows. The SET target is unambiguously a column; the WHERE is
  -- qualified for the same reason as above.
  UPDATE referral_earnings re
     SET status = 'in_transit', payout_id = v_payout
   WHERE re.id = ANY (v_ids);

  RETURN QUERY SELECT v_payout, v_total, v_agent.stripe_connect_account_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION rail_open_payout(uuid, date, timestamptz, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION rail_open_payout(uuid, date, timestamptz, boolean)
  TO service_role;

-- ── rail_close_payout ───────────────────────────────────────────────────────
-- Idempotent by design: closing an already-closed payout with the SAME outcome is a
-- no-op; with a DIFFERENT outcome it raises. A transfer that settled must never be
-- reported failed, and a failure must never be quietly overwritten as paid.
CREATE FUNCTION rail_close_payout(
  p_payout       uuid,
  p_outcome      text,
  p_transfer_id  text,
  p_failure_code text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_payout record;
BEGIN
  IF p_payout IS NULL THEN
    RAISE EXCEPTION 'rail_close_payout: p_payout is required' USING ERRCODE = '22023';
  END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('paid','failed') THEN
    RAISE EXCEPTION 'rail_close_payout: p_outcome must be paid or failed' USING ERRCODE = '22023';
  END IF;

  SELECT id, status, stripe_transfer_id INTO v_payout
    FROM payouts WHERE id = p_payout FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'rail_close_payout: payout % does not exist', p_payout USING ERRCODE = '22023';
  END IF;

  -- already closed
  IF v_payout.status <> 'created' THEN
    IF v_payout.status = p_outcome THEN
      RETURN;  -- same outcome: no-op
    END IF;
    RAISE EXCEPTION 'rail_close_payout: payout % is already % and cannot become %',
      p_payout, v_payout.status, p_outcome USING ERRCODE = '22023';
  END IF;

  IF p_outcome = 'paid' THEN
    IF p_transfer_id IS NULL OR btrim(p_transfer_id) = '' THEN
      RAISE EXCEPTION 'rail_close_payout: a paid close requires a transfer id'
        USING ERRCODE = '22023';
    END IF;
    UPDATE payouts
       SET status = 'paid', paid_at = now(), stripe_transfer_id = p_transfer_id,
           updated_at = now()
     WHERE id = p_payout;
    UPDATE referral_earnings re
       SET status = 'paid', paid_at = now()
     WHERE re.payout_id = p_payout;
  ELSE
    UPDATE payouts
       SET status = 'failed', failure_code = p_failure_code, updated_at = now()
     WHERE id = p_payout;
    -- rows go back to pending so the next run can retry them; payout_id is cleared,
    -- which the payout_link CHECK requires for a pending row.
    UPDATE referral_earnings re
       SET status = 'pending', payout_id = NULL
     WHERE re.payout_id = p_payout;
  END IF;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION rail_close_payout(uuid, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION rail_close_payout(uuid, text, text, text)
  TO service_role;

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFICATION (run after; every line should answer as noted)
-- ----------------------------------------------------------------------------
-- SELECT count(*) FROM rail_legacy_rows;                      -- expect 4
-- SELECT count(*) FROM referral_earnings;                     -- expect 0
-- SELECT count(*) FROM hive_revenue;                          -- expect 0
-- SELECT count(*) FROM information_schema.columns
--   WHERE table_name='referral_earnings' AND column_name='wallet_address';   -- expect 0
-- SELECT proname, prosecdef, proconfig FROM pg_proc
--   WHERE proname LIKE 'rail\_%';   -- expect 3 rows, prosecdef true,
--                                   -- proconfig {search_path=public, pg_temp}
-- SELECT has_table_privilege('anon','referral_earnings','SELECT');  -- expect false
-- SELECT has_function_privilege('anon','rail_accrue(text,uuid,integer,date,boolean,jsonb)','EXECUTE');
--                                                             -- expect false
