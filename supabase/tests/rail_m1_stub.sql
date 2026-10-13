-- supabase/tests/rail_m1_stub.sql
-- ----------------------------------------------------------------------------
-- THE HIVE — LOCAL SCRATCH stubs for exercising migration M1. Ticket NIK-RAIL-002.
--
-- THIS FILE IS NEVER RUN AGAINST SUPABASE. It builds a throwaway schema in a local
-- database (psql -d railtest) that matches the production column list closely enough
-- for M1 to be a real test: the same column names and types on the five tables M1
-- touches, the same anon/authenticated grants (so the REVOKE has something to revoke),
-- and the four legacy rows with their exact production values.
--
-- Column lists are the Oct 11/12 readout, transcribed by the chat seat into the ticket.
-- agents and members are deliberate SUBSETS — only what M1, the functions and the
-- self-test read. referral_earnings, hive_revenue and stripe_events are the full
-- production shape.
--
-- Idempotent: it drops what it created first, so a test round can rebuild from scratch.
-- ----------------------------------------------------------------------------

-- ── roles ───────────────────────────────────────────────────────────────────
-- NOLOGIN: these exist to be the subject of GRANT/REVOKE and SET ROLE, never to
-- connect. Supabase ships them; a local scratch database does not.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  -- BYPASSRLS mirrors Supabase, which creates service_role that way. Without it the
  -- scratch role could CALL the rail functions (they are SECURITY DEFINER, so the
  -- INSERT succeeds) but a direct SELECT returned 0 rows because RLS is on with no
  -- policy — which would have read as a privilege failure when it is a stub artefact.
  -- Found by the 2f run against railtest.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
  ALTER ROLE service_role BYPASSRLS;
END $$;

-- ── drop in dependency order ────────────────────────────────────────────────
DROP TABLE IF EXISTS payout_notices CASCADE;
DROP TABLE IF EXISTS rail_legacy_rows CASCADE;
DROP TABLE IF EXISTS referral_earnings CASCADE;
DROP TABLE IF EXISTS hive_revenue CASCADE;
DROP TABLE IF EXISTS payouts CASCADE;
DROP TABLE IF EXISTS stripe_events CASCADE;
DROP TABLE IF EXISTS members CASCADE;
DROP TABLE IF EXISTS agents CASCADE;
DROP FUNCTION IF EXISTS rail_accrue(text, uuid, integer, date, boolean, jsonb);
DROP FUNCTION IF EXISTS rail_open_payout(uuid, date, timestamptz, boolean);
DROP FUNCTION IF EXISTS rail_close_payout(uuid, text, text, text);
DROP FUNCTION IF EXISTS reset_premium_tokens_if_due(uuid);
DROP FUNCTION IF EXISTS bump_pollen_on_transaction();

-- ── agents (production subset) ──────────────────────────────────────────────
CREATE TABLE agents (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        varchar NOT NULL UNIQUE,
  email                       varchar NOT NULL UNIQUE,
  eth_wallet                  varchar,
  status                      varchar DEFAULT 'first_flight',
  is_staff                    boolean DEFAULT false,
  tier                        varchar DEFAULT 'worker',
  pollen_earned               integer DEFAULT 0,
  monthly_premium_tokens_used integer DEFAULT 0,
  premium_tokens_period_start timestamptz DEFAULT now()
);

-- ── members (production subset) ─────────────────────────────────────────────
CREATE TABLE members (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email    text NOT NULL UNIQUE,
  agent_id uuid REFERENCES agents(id)
);

-- ── referral_earnings (production shape, pre-M1) ────────────────────────────
-- No NOT NULL beyond id, no UNIQUE, no CHECK. That is the defect M1 closes (D14).
CREATE TABLE referral_earnings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz DEFAULT now(),
  earning_agent_id    uuid REFERENCES agents(id),
  source_agent_id     uuid REFERENCES agents(id),
  subscription_month  date,
  level               integer,
  percentage          numeric,
  subscription_amount numeric,
  earned_amount       numeric,
  status              text DEFAULT 'pending',
  paid_at             timestamptz,
  wallet_address      text
);

-- ── hive_revenue (production shape, pre-M1) ─────────────────────────────────
CREATE TABLE hive_revenue (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz DEFAULT now(),
  source_agent_id     uuid REFERENCES agents(id),
  subscription_month  date,
  subscription_amount numeric,
  referral_paid_out   numeric,
  hive_kept           numeric,
  chain_depth         integer
);

-- ── stripe_events ───────────────────────────────────────────────────────────
CREATE TABLE stripe_events (
  event_id    text PRIMARY KEY,
  event_type  text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- ── the two functions M1 revokes EXECUTE on ─────────────────────────────────
-- Stubs with the production signatures. reset_premium_tokens_if_due is NOT security
-- definer in production; bump_pollen_on_transaction returns trigger and so cannot be
-- called as an RPC at all (§4.6, read Oct 12).
CREATE FUNCTION reset_premium_tokens_if_due(p_agent_id uuid) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE agents
     SET monthly_premium_tokens_used = 0,
         premium_tokens_period_start = now()
   WHERE id = p_agent_id
     AND premium_tokens_period_start < date_trunc('month', now());
  RETURN FOUND;
END $$;

CREATE FUNCTION bump_pollen_on_transaction() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RETURN NEW;
END $$;

-- ── RLS and the production grants ───────────────────────────────────────────
-- RLS is ON with no policy for anon or authenticated, which blocks ROW access; the
-- table grants below are what M1's REVOKE has to take away. Granting them here is the
-- whole point: without them the REVOKE would pass vacuously (D13).
ALTER TABLE agents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE members           ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hive_revenue      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stripe_events     ENABLE ROW LEVEL SECURITY;

GRANT ALL ON agents, members, referral_earnings, hive_revenue, stripe_events
  TO anon, authenticated;
GRANT ALL ON agents, members, referral_earnings, hive_revenue, stripe_events
  TO service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ── the two agents ──────────────────────────────────────────────────────────
-- 82ad1cbb… is the paying source. 873a5c1c… is the earner and is_staff, which is why
-- it is an active earner under the rule in rail_open_payout whatever its tier says.
INSERT INTO agents (id, name, email, status, is_staff, tier) VALUES
  ('82ad1cbb-e2b7-443b-9889-b2d5aab37ca6', 'SOURCE_AGENT', 'source@example.test',
   'active', false, 'worker'),
  ('873a5c1c-efa8-4e00-95ee-9d5900e72160', 'ESMERALDA',    'esmeralda@example.test',
   'active', true,  'worker');

-- ── the four legacy rows, exact values ──────────────────────────────────────
-- The Aug row pairs level 1 with percentage 10 (the pre-v1.3 rate) — exactly the row
-- the new CHECKs rightly forbid, which is why ruling R-F archives rather than backfills.
INSERT INTO referral_earnings
  (id, created_at, earning_agent_id, source_agent_id, subscription_month,
   level, percentage, subscription_amount, earned_amount, status, paid_at, wallet_address)
VALUES
  ('4bf22c8a-0aab-4f23-ac95-ae4678b5d11e', '2026-08-21T11:10:25.285827+00',
   '873a5c1c-efa8-4e00-95ee-9d5900e72160', '82ad1cbb-e2b7-443b-9889-b2d5aab37ca6',
   '2026-08-01', 1, 10, 10, 1, 'reversed', NULL, NULL),
  ('a146711d-bb62-49b7-81a4-485f7652544a', '2026-09-21T12:11:09.878206+00',
   '873a5c1c-efa8-4e00-95ee-9d5900e72160', '82ad1cbb-e2b7-443b-9889-b2d5aab37ca6',
   '2026-09-01', 1, 20, 10, 2, 'pending',  NULL, NULL);

INSERT INTO hive_revenue
  (id, created_at, source_agent_id, subscription_month,
   subscription_amount, referral_paid_out, hive_kept, chain_depth)
VALUES
  ('ab45343e-2b11-4ccd-804b-11e9448dbc28', '2026-08-21T11:10:25.320829+00',
   '82ad1cbb-e2b7-443b-9889-b2d5aab37ca6', '2026-08-01', 10, 1, 9, 1),
  ('9ecd2b43-5b9e-450c-bcf6-3093d91940e2', '2026-09-21T12:11:09.966066+00',
   '82ad1cbb-e2b7-443b-9889-b2d5aab37ca6', '2026-09-01', 10, 2, 8, 1);

SELECT 'stub built' AS status,
       (SELECT count(*) FROM agents)            AS agents,
       (SELECT count(*) FROM referral_earnings)  AS earnings,
       (SELECT count(*) FROM hive_revenue)       AS revenue;
