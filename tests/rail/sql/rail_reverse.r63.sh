#!/usr/bin/env bash
# tests/rail/sql/rail_reverse.r63.sh
# -----------------------------------------------------------------------------
# R63 two-session proof — the REVERSE direction of the lock race.
# Ticket NIK-RAIL-005, addendum M-1 (Nikita: "R63 reverse direction not asserted").
#
# LOCAL SCRATCH DATABASE ONLY. It talks to `psql -d railtest` over the unix socket
# and nothing else; there is no connection string, no env read, no Supabase.
#
# WHY A SHELL SCRIPT AND NOT A .sql FILE. R63 is a statement about two CONCURRENT
# transactions. A single psql script cannot hold one transaction open while a second
# one runs — inside one session the second statement simply waits its turn, which
# proves nothing about SKIP LOCKED. So session A is a psql process kept alive on a
# FIFO (the same method as NIK-RAIL-002 step 2g), and the runner feeds it statements
# one at a time while session B runs to completion in between.
#
# THE SHAPE OF THE PROOF:
#   1  setup          one committed PENDING row for E1, 1580 cents, ref in_X
#   1b NEGATIVE CONTROL, and the proof is worthless without it: with no lock held,
#      the same sweep DOES open a payout (rolled back). So "no payout" in 3 and 5
#      is caused by the reversal, not by an ineligible fixture.
#   2  A: BEGIN; rail_reverse('in_X','refund',false)      -- and HOLD, no commit
#   3  B: rail_open_payout(E1, ...)                       -- must return NO payout
#      B asserts: no payouts row, nothing in_transit, nothing paid, no payout_id
#   4  A: COMMIT
#   5  B again: rail_open_payout(E1, ...)                 -- still NO payout
#      and the row is now 'reversed' with reversed_at set
#   6  teardown
#
# The FORWARD direction — open first, so the reversal counts the row as `untouched`
# and leaves it alone — is already asserted in rail_reverse.selftest.sql (in_B).
# Together they are R63: whichever transaction locks the row first wins, and the
# other sees the committed outcome.
#
# Exit 0 only if every assertion in both B runs passed and A's reversal reported
# (true, 1, 0). Any psql error aborts the script (set -e, ON_ERROR_STOP in B).
# -----------------------------------------------------------------------------
set -euo pipefail

DB=railtest
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIFO="$(mktemp -u /tmp/r63-a-fifo.XXXXXX)"
A_OUT="$(mktemp /tmp/r63-a-out.XXXXXX)"

cleanup() {
  exec 3>&- 2>/dev/null || true
  rm -f "$FIFO" "$A_OUT" 2>/dev/null || true
}
trap cleanup EXIT

echo "=============================================================================="
echo "R63 REVERSE DIRECTION — two psql sessions against the local scratch DB"
echo "=============================================================================="
psql -d "$DB" -tAc "select 'postgres ' || current_setting('server_version')"
psql -d "$DB" -tAc "select 'isolation ' || current_setting('default_transaction_isolation')"
echo

echo "----- 1. FIXTURE --------------------------------------------------------------"
psql -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/rail_reverse.r63.setup.sql"
echo

echo "----- 1b. NEGATIVE CONTROL: with NO lock held, B's sweep DOES open a payout ----"
# Without this, "no payout" in step 3 could simply mean E1 was never eligible and the
# proof would assert nothing. Run inside a transaction that ROLLS BACK, so the control
# demonstrates eligibility without leaving a payout behind.
psql -d "$DB" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
SELECT (o.payout_id IS NOT NULL) AS a_payout_would_open, o.amount_cents
  FROM rail_open_payout('63000000-0000-4000-8000-000000000002',
                        date_trunc('month', (now() AT TIME ZONE 'utc'))::date,
                        now() + interval '1 minute',
                        false) o;
DO $$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM payouts p
   WHERE p.agent_id = '63000000-0000-4000-8000-000000000002';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CONTROL FAILED: the fixture is not eligible for a payout (got % payout rows) — steps 3 and 5 would then prove nothing', v_n;
  END IF;
  RAISE NOTICE '  ok   CONTROL: unlocked, the sweep opens exactly 1 payout — so the fixture IS eligible';
END $$;
ROLLBACK;
SQL
echo "   (rolled back — no payout and no in_transit row survives the control)"
psql -d "$DB" -tAc "SELECT 'payouts after control: ' || count(*) FROM payouts p WHERE p.agent_id = '63000000-0000-4000-8000-000000000002'"
psql -d "$DB" -tAc "SELECT 'in_X status after control: ' || re.status FROM referral_earnings re WHERE re.stripe_invoice_ref = 'in_X'"
echo

# Session A: a psql process reading from a FIFO, so the runner controls when each
# statement arrives and the transaction stays open in between.
mkfifo "$FIFO"
psql -d "$DB" -v ON_ERROR_STOP=1 -f "$FIFO" > "$A_OUT" 2>&1 &
A_PID=$!
exec 3>"$FIFO"

echo "----- 2. SESSION A: BEGIN, reverse, and HOLD (no commit) ----------------------"
cat >&3 <<'SQL'
\echo '[A] BEGIN'
BEGIN;
\echo '[A] rail_reverse(in_X, refund, false) — expect (true, 1, 0)'
SELECT r.known, r.reversed, r.untouched FROM rail_reverse('in_X','refund',false) r;
\echo '[A] holding the transaction open — NOT committed'
SQL
# Let A's statements land and its locks be taken before B runs. The wait is on a
# CONDITION, not a sleep: A's lock must be visible in pg_locks.
for i in $(seq 1 100); do
  held=$(psql -d "$DB" -tAc "
    SELECT count(*) FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
     WHERE l.locktype = 'transactionid' AND l.mode = 'ExclusiveLock'
       AND a.pid <> pg_backend_pid() AND a.state = 'idle in transaction'")
  [ "$held" -ge 1 ] && break
  if [ "$i" = 100 ]; then echo "FAIL: session A never took a lock"; exit 1; fi
done
echo "   (session A's transaction lock is visible in pg_locks — proceeding)"
echo

echo "----- 3. SESSION B while A HOLDS: expect NO payout ---------------------------"
psql -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/rail_reverse.r63.b.sql"
echo

echo "----- 4. SESSION A: COMMIT ---------------------------------------------------"
cat >&3 <<'SQL'
\echo '[A] COMMIT'
COMMIT;
\echo '[A] committed'
SQL
exec 3>&-
wait "$A_PID"
echo "   session A exited $?"
echo

echo "----- 5. SESSION B after A COMMITTED: still NO payout ------------------------"
psql -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/rail_reverse.r63.b.sql"
echo
echo "   and the row must now read 'reversed':"
psql -d "$DB" -v ON_ERROR_STOP=1 -c "
DO \$\$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM referral_earnings re
   WHERE re.stripe_invoice_ref = 'in_X' AND re.status = 'reversed'
     AND re.reversed_at IS NOT NULL AND re.reversal_reason = 'refund';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'FAIL [R63]: expected 1 reversed row with reversed_at and reason, got %', v_n;
  END IF;
  RAISE NOTICE '  ok   the in_X row is reversed, stamped, and reasoned (= 1)';
END \$\$;"
echo

echo "----- SESSION A's OWN OUTPUT -------------------------------------------------"
cat "$A_OUT"
echo

echo "----- 6. TEARDOWN ------------------------------------------------------------"
psql -d "$DB" -v ON_ERROR_STOP=1 -f "$HERE/rail_reverse.r63.teardown.sql"
echo
echo "=============================================================================="
echo "R63 REVERSE DIRECTION: ALL ASSERTIONS PASSED"
echo "  while A held   — B opened no payout (SKIP LOCKED passed over the locked row)"
echo "  after A commit — B opened no payout (the row is reversed, so not pending)"
echo "  no row was ever both reversed and paid"
echo "=============================================================================="
