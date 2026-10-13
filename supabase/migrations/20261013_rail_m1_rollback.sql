-- 20261013_rail_m1_rollback.sql
-- ----------------------------------------------------------------------------
-- THE HIVE — rollback for payout rail migration M1. RAIL-DESIGN-v1.1 §4.
-- Design sha256 21cff4b4d85cee6af03660effda68111dbcd5862d89f8cf60701ba76490df3f9.
-- Ticket NIK-RAIL-002. ONE TRANSACTION.
--
-- NOT RUN BY THIS SESSION: nothing here was executed against any database.
--
-- IT REFUSES TO RUN IF THE RAIL HAS BEEN USED (Nikita OBS4). The guard below raises,
-- and the transaction changes nothing, if referral_earnings, hive_revenue, payouts or
-- payout_notices holds ANY row. Rolling the schema back under live money would drop the
-- columns those rows depend on and silently discard accruals, transfers and notices.
-- Once the rail has written a single row, going back is a data decision for a human and
-- not a migration.
--
-- Order is the reverse of M1: functions, then payout_notices, then the agents columns,
-- then hive_revenue, then referral_earnings (restoring wallet_address BEFORE the rows
-- come back, since the archived rows carry it), then the legacy rows, then payouts last
-- because referral_earnings.payout_id references it.
-- ----------------------------------------------------------------------------
BEGIN;

-- ============================================================================
-- GUARD (OBS4) — refuse if the rail has been used
-- ============================================================================
DO $$
DECLARE
  v_earn    bigint;
  v_rev     bigint;
  v_payouts bigint;
  v_notices bigint;
BEGIN
  SELECT count(*) INTO v_earn    FROM referral_earnings;
  SELECT count(*) INTO v_rev     FROM hive_revenue;
  SELECT count(*) INTO v_payouts FROM payouts;
  SELECT count(*) INTO v_notices FROM payout_notices;

  IF v_earn <> 0 OR v_rev <> 0 OR v_payouts <> 0 OR v_notices <> 0 THEN
    RAISE EXCEPTION
      'rail M1 rollback: the rail has been used (referral_earnings=%, hive_revenue=%, payouts=%, payout_notices=%); refusing. Rolling back under live money would drop the columns those rows depend on. This is now a data decision for a human.',
      v_earn, v_rev, v_payouts, v_notices;
  END IF;
END $$;

-- ============================================================================
-- 1 · the three functions
-- ============================================================================
DROP FUNCTION IF EXISTS rail_close_payout(uuid, text, text, text);
DROP FUNCTION IF EXISTS rail_open_payout(uuid, date, timestamptz, boolean);
DROP FUNCTION IF EXISTS rail_accrue(text, uuid, integer, date, boolean, jsonb);

-- ============================================================================
-- 2 · payout_notices
-- ============================================================================
DROP TABLE IF EXISTS payout_notices;

-- ============================================================================
-- 3 · agents — the Connect columns (§4.1)
-- ============================================================================
-- eth_wallet and strike_username were never touched by M1 and are not touched here.
ALTER TABLE agents
  DROP COLUMN IF EXISTS stripe_connect_account_id,
  DROP COLUMN IF EXISTS connect_payouts_enabled,
  DROP COLUMN IF EXISTS connect_details_submitted,
  DROP COLUMN IF EXISTS stripe_requirements_json,
  DROP COLUMN IF EXISTS connect_livemode,
  DROP COLUMN IF EXISTS connect_updated_at;

-- ============================================================================
-- 4 · hive_revenue (§4.4)
-- ============================================================================
ALTER TABLE hive_revenue
  DROP CONSTRAINT IF EXISTS hive_revenue_split_chk,
  DROP CONSTRAINT IF EXISTS hive_revenue_kept_chk,
  DROP CONSTRAINT IF EXISTS hive_revenue_referral_paid_chk,
  DROP CONSTRAINT IF EXISTS hive_revenue_source_amount_chk,
  DROP CONSTRAINT IF EXISTS hive_revenue_invoice_uniq;

ALTER TABLE hive_revenue
  DROP COLUMN IF EXISTS stripe_invoice_ref,
  DROP COLUMN IF EXISTS source_amount_cents,
  DROP COLUMN IF EXISTS referral_paid_cents,
  DROP COLUMN IF EXISTS hive_kept_cents,
  DROP COLUMN IF EXISTS livemode;

-- ============================================================================
-- 5 · referral_earnings (§4.2)
-- ============================================================================
ALTER TABLE referral_earnings
  DROP CONSTRAINT IF EXISTS referral_earnings_paid_at_chk,
  DROP CONSTRAINT IF EXISTS referral_earnings_level_rate_chk,
  DROP CONSTRAINT IF EXISTS referral_earnings_payout_link_chk,
  DROP CONSTRAINT IF EXISTS referral_earnings_rate_chk,
  DROP CONSTRAINT IF EXISTS referral_earnings_source_amount_chk,
  DROP CONSTRAINT IF EXISTS referral_earnings_amount_chk,
  DROP CONSTRAINT IF EXISTS referral_earnings_level_chk,
  DROP CONSTRAINT IF EXISTS referral_earnings_status_chk,
  DROP CONSTRAINT IF EXISTS referral_earnings_invoice_level_uniq;

-- The NOT NULLs M1 set. earning_agent_id, source_agent_id, level and status were
-- NULLABLE before M1 (schema readout Oct 11: no NOT NULL beyond id), so they go back.
ALTER TABLE referral_earnings
  ALTER COLUMN earning_agent_id DROP NOT NULL,
  ALTER COLUMN source_agent_id  DROP NOT NULL,
  ALTER COLUMN level            DROP NOT NULL,
  ALTER COLUMN status           DROP NOT NULL;

ALTER TABLE referral_earnings
  DROP COLUMN IF EXISTS stripe_invoice_ref,
  DROP COLUMN IF EXISTS amount_cents,
  DROP COLUMN IF EXISTS source_amount_cents,
  DROP COLUMN IF EXISTS rate_bps,
  DROP COLUMN IF EXISTS period_month,
  DROP COLUMN IF EXISTS livemode,
  DROP COLUMN IF EXISTS payout_id,
  DROP COLUMN IF EXISTS reversed_at,
  DROP COLUMN IF EXISTS reversal_reason;

-- wallet_address comes BACK before the archived rows are restored, because those rows
-- carry it (§4.2: it was dropped in M1 as a copy of eth_wallet on a money row).
ALTER TABLE referral_earnings ADD COLUMN IF NOT EXISTS wallet_address text;

-- ============================================================================
-- 6 · restore the four legacy rows (§4.4)
-- ============================================================================
-- jsonb_populate_record against the table's CURRENT shape, which the steps above have
-- returned to its pre-M1 form. Keys in the archived row that no longer exist are
-- ignored; keys that exist and are absent come back NULL. wallet_address is restored
-- because step 5 put the column back first.
INSERT INTO referral_earnings
  SELECT (jsonb_populate_record(NULL::referral_earnings, row)).*
    FROM rail_legacy_rows
   WHERE source_table = 'referral_earnings'
   ORDER BY id;

INSERT INTO hive_revenue
  SELECT (jsonb_populate_record(NULL::hive_revenue, row)).*
    FROM rail_legacy_rows
   WHERE source_table = 'hive_revenue'
   ORDER BY id;

-- Proof that the restore put back exactly what was archived, inside the same
-- transaction, so a short count rolls the whole rollback back.
DO $$
DECLARE
  v_want_earn bigint;
  v_want_rev  bigint;
  v_got_earn  bigint;
  v_got_rev   bigint;
BEGIN
  SELECT count(*) INTO v_want_earn FROM rail_legacy_rows WHERE source_table = 'referral_earnings';
  SELECT count(*) INTO v_want_rev  FROM rail_legacy_rows WHERE source_table = 'hive_revenue';
  SELECT count(*) INTO v_got_earn  FROM referral_earnings;
  SELECT count(*) INTO v_got_rev   FROM hive_revenue;
  IF v_got_earn <> v_want_earn OR v_got_rev <> v_want_rev THEN
    RAISE EXCEPTION
      'rail M1 rollback: restore is short (referral_earnings %/%, hive_revenue %/%)',
      v_got_earn, v_want_earn, v_got_rev, v_want_rev;
  END IF;
END $$;

DROP TABLE rail_legacy_rows;

-- ============================================================================
-- 7 · payouts — last, because referral_earnings.payout_id referenced it
-- ============================================================================
DROP INDEX IF EXISTS payouts_one_open_per_agent;
DROP TABLE IF EXISTS payouts;

-- ============================================================================
-- 8 · what is NOT restored, stated plainly
-- ============================================================================
-- The REVOKEs from §4.6 are LEFT IN PLACE, deliberately. Less access is never a
-- regression, the audit (RAIL-revoke-audit.txt, Oct 11) proved no code path depends on
-- anon or authenticated reaching these tables, and re-granting TRUNCATE on the money
-- tables to anon in order to "restore" a prior state would be the only destructive act
-- in this file. The same reasoning as 20261004_ezzy_night_read_v2_rollback.sql.
--
-- RLS stays enabled on the tables that had it before M1. ENABLE ROW LEVEL SECURITY on
-- payouts and payout_notices disappears with the tables themselves.

COMMIT;

-- ----------------------------------------------------------------------------
-- VERIFICATION (run after)
-- ----------------------------------------------------------------------------
-- SELECT count(*) FROM referral_earnings;   -- expect 2 (the archived rows, restored)
-- SELECT count(*) FROM hive_revenue;        -- expect 2
-- SELECT count(*) FROM information_schema.columns
--   WHERE table_name='referral_earnings' AND column_name='wallet_address';   -- expect 1
-- SELECT count(*) FROM information_schema.tables
--   WHERE table_name IN ('payouts','payout_notices','rail_legacy_rows');     -- expect 0
-- SELECT count(*) FROM pg_proc WHERE proname LIKE 'rail\_%';                 -- expect 0
