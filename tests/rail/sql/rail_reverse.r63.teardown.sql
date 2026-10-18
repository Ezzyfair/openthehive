-- tests/rail/sql/rail_reverse.r63.teardown.sql
-- R63 two-session proof · TEARDOWN. Removes only what the setup committed, so the
-- scratch database is left as the self-test found it. LOCAL SCRATCH ONLY.
BEGIN;
DELETE FROM payout_notices n
 WHERE n.agent_id IN ('63000000-0000-4000-8000-000000000001',
                      '63000000-0000-4000-8000-000000000002');
DELETE FROM referral_earnings re WHERE re.stripe_invoice_ref = 'in_X';
DELETE FROM payouts p
 WHERE p.agent_id IN ('63000000-0000-4000-8000-000000000001',
                      '63000000-0000-4000-8000-000000000002');
DELETE FROM hive_revenue h WHERE h.stripe_invoice_ref = 'in_X';
DELETE FROM agents a
 WHERE a.id IN ('63000000-0000-4000-8000-000000000001',
                '63000000-0000-4000-8000-000000000002');
COMMIT;
\echo '-- teardown done; the three counts below must all be 0 --'
SELECT (SELECT count(*) FROM referral_earnings re WHERE re.stripe_invoice_ref = 'in_X') AS earnings,
       (SELECT count(*) FROM hive_revenue h WHERE h.stripe_invoice_ref = 'in_X') AS revenue,
       (SELECT count(*) FROM agents a WHERE a.name LIKE 'R63\_%') AS fixture_agents;
