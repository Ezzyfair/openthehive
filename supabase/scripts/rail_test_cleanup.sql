-- supabase/scripts/rail_test_cleanup.sql
-- ----------------------------------------------------------------------------
-- THE HIVE — remove the TEST-MODE rail rows left by a staging proof.
-- Ruling R-A (Francis) · ticket NIK-RAIL-005 §5.
--
-- NOT RUN BY ANYONE UNTIL NIKITA HAS READ IT. Not by this session, not by a deploy,
-- not by prebuild. Francis runs it by hand after the staging refund proof, in the
-- SQL editor or with psql, and only then.
--
-- WHAT IT DELETES, and the three fences that keep it narrow:
--   1. livemode = false ONLY, on every statement that CAN carry it — the three money
--      tables all have the column. payout_notices does not have one at all, so that
--      single DELETE is fenced by agent id alone; it is called out at the statement.
--      A live money row is never in scope, so the worst outcome of a wrong agent id
--      is the loss of test data.
--   2. Only rows whose SOURCE or EARNER is one of three agent ids passed in as psql
--      variables. Nothing is deleted by date, by amount, or by "everything in test
--      mode" — an id you did not name is not touched.
--   3. One transaction, with the counts printed BEFORE the COMMIT, so the numbers can
--      be read and the whole thing abandoned with ROLLBACK if they look wrong.
--
-- HOW TO RUN IT — the variables are REQUIRED and the script refuses to run without
-- them (psql substitutes :'testbee1' as a literal; an unset variable raises):
--
--   psql "$SUPABASE_DB_URL" \
--     -v testbee1='<uuid>' -v testbee2='<uuid>' -v testbee3='<uuid>' \
--     -f supabase/scripts/rail_test_cleanup.sql
--
-- READ THE COUNTS, THEN DECIDE. The script ends with COMMIT. To inspect without
-- committing, run it with `-v ON_ERROR_STOP=1 --single-transaction` and a ROLLBACK,
-- or simply change the last line to ROLLBACK for a dry run — the counts are printed
-- either way.
--
-- WHY payout_notices AND payouts ARE IN SCOPE: a test payout opens a payouts row and
-- may write a payout_notices row; leaving the payouts row behind makes the next
-- monthly run's partial unique index (one open payout per agent) refuse a real open
-- for that agent, and leaving the notice behind makes
-- payout_notices_one_per_kind_month refuse the next real notice for that month.
-- hive_revenue rows are deleted LAST because referral_earnings rows reference the
-- same invoice ref and a human reading a half-cleaned table should still see the
-- revenue row that explains the accruals.
-- ----------------------------------------------------------------------------

\set ON_ERROR_STOP on

BEGIN;

-- The three ids, as a list we can join against rather than repeating three times.
CREATE TEMP TABLE _cleanup_agents (id uuid PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _cleanup_agents (id) VALUES
  (:'testbee1'::uuid),
  (:'testbee2'::uuid),
  (:'testbee3'::uuid);

-- ── BEFORE ──────────────────────────────────────────────────────────────────
\echo '── BEFORE (test mode, the three named agents only) ──'
SELECT 'referral_earnings' AS table_name, count(*) AS rows
  FROM referral_earnings re
 WHERE re.livemode = false
   AND (re.earning_agent_id IN (SELECT id FROM _cleanup_agents)
        OR re.source_agent_id IN (SELECT id FROM _cleanup_agents))
UNION ALL
SELECT 'hive_revenue', count(*)
  FROM hive_revenue h
 WHERE h.livemode = false
   AND h.source_agent_id IN (SELECT id FROM _cleanup_agents)
UNION ALL
SELECT 'payouts', count(*)
  FROM payouts p
 WHERE p.livemode = false
   AND p.agent_id IN (SELECT id FROM _cleanup_agents)
UNION ALL
SELECT 'payout_notices', count(*)
  FROM payout_notices n
 WHERE n.agent_id IN (SELECT id FROM _cleanup_agents);

-- ── DELETE, children first ──────────────────────────────────────────────────
-- payout_notices is scoped by AGENT ID ALONE, and that is a measured exception to
-- fence 1 rather than an oversight: the table has NO livemode column and NO payout_id
-- (M1 §4.5 — agent_id, kind, period_month, balance_cents, email_send_id). The first
-- draft of this script filtered n.payout_id and would have failed with 42703. A notice
-- is a record that an email was sent, not money, and the three ids are test bees, so
-- deleting all of their notices is the intended effect — but it is the one statement
-- here that would also remove a live-mode notice, and a reviewer should see that
-- stated rather than discover it.
DELETE FROM payout_notices n
 WHERE n.agent_id IN (SELECT id FROM _cleanup_agents);

-- referral_earnings before payouts: an earning row references its payout.
DELETE FROM referral_earnings re
 WHERE re.livemode = false
   AND (re.earning_agent_id IN (SELECT id FROM _cleanup_agents)
        OR re.source_agent_id IN (SELECT id FROM _cleanup_agents));

DELETE FROM payouts p
 WHERE p.livemode = false
   AND p.agent_id IN (SELECT id FROM _cleanup_agents);

DELETE FROM hive_revenue h
 WHERE h.livemode = false
   AND h.source_agent_id IN (SELECT id FROM _cleanup_agents);

-- ── AFTER ───────────────────────────────────────────────────────────────────
\echo '── AFTER (all four must be 0) ──'
SELECT 'referral_earnings' AS table_name, count(*) AS rows
  FROM referral_earnings re
 WHERE re.livemode = false
   AND (re.earning_agent_id IN (SELECT id FROM _cleanup_agents)
        OR re.source_agent_id IN (SELECT id FROM _cleanup_agents))
UNION ALL
SELECT 'hive_revenue', count(*)
  FROM hive_revenue h
 WHERE h.livemode = false
   AND h.source_agent_id IN (SELECT id FROM _cleanup_agents)
UNION ALL
SELECT 'payouts', count(*)
  FROM payouts p
 WHERE p.livemode = false
   AND p.agent_id IN (SELECT id FROM _cleanup_agents)
UNION ALL
SELECT 'payout_notices', count(*)
  FROM payout_notices n
 WHERE n.agent_id IN (SELECT id FROM _cleanup_agents);

-- A LIVE-MODE SAFETY READ, printed so the operator sees it was never in scope.
\echo '── live-mode rows for these agents (must be unchanged by this script) ──'
SELECT 'referral_earnings LIVE' AS table_name, count(*) AS rows
  FROM referral_earnings re
 WHERE re.livemode = true
   AND (re.earning_agent_id IN (SELECT id FROM _cleanup_agents)
        OR re.source_agent_id IN (SELECT id FROM _cleanup_agents));

COMMIT;
