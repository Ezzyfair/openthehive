-- Migration: Antenna v1 — bee-client tables, atomic activation, locked-down grants
-- For: XI-1 ANTENNA DESIGN v0.2.2 — §9 (tables), §6.5 (antenna_activate), §6.4 (token storage),
--      §6.12 (audit). Build order §13 step 1.
-- Ticket: NIK-ANTENNA-003 — PASSed Sept 13, 2026, with FIND-MIG-1 applied (see AMENDMENTS below).
-- Date: September 13, 2026
-- Run in: Supabase SQL editor. No deploy runs this file.
-- Rollback: 20260913_antenna_v1_rollback.sql (sibling, same directory)
--
-- AMENDMENTS after the PASS (NIK-ANTENNA-003 FIND-MIG-1, option a; design v0.2.2 §6.5/§9):
--   1. bee_tokens_one_active_per_agent — partial UNIQUE index. "One live token per agent"
--      becomes a schema property rather than a runtime behavior.
--   2. antenna_activate() supersedes existing live tokens BEFORE the INSERT, not after.
--   3. SQLSTATE for a bad install token is P0410 (was AN410).
--   4. SET search_path = pg_catalog, public (was public, pg_temp).
--
-- POSTURE (§9): RLS enabled with ZERO policies on all three tables, plus
-- REVOKE ALL FROM anon, authenticated. Same posture as the money tables. Nothing
-- reaches these tables except the service role and the SECURITY DEFINER function below.
--
-- WHY RLS IS NOT FORCED: antenna_activate() is SECURITY DEFINER and executes as the
-- table owner. FORCE ROW LEVEL SECURITY would apply the empty policy set to the owner
-- as well, and the function could never write a row. Enabled-but-unforced RLS with zero
-- policies is what §9 asks for and is what keeps the function working.
--
-- CONVENTION: TEXT + CHECK for the enumerated columns, matching
-- 20260426_skill_masteries.sql and 20260427_cohort_engagement.sql. No new PG ENUM types,
-- so a later value change is an ALTER of a constraint rather than a type migration.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1 · bee_tokens (§9) — one live token per bee; older ones marked 'superseded'
-- ─────────────────────────────────────────────────────────────────────────────
-- token format (§6.4): hive_bee_<token_id>.<secret>
--   token_id   lookup key, stored in the clear (it is not a secret)
--   salt       per-row 32 random bytes, hex-encoded
--   token_hash sha256(salt || secret), hex-encoded
-- Plaintext of the secret exists only in the activation response and the bee's hive.json.
CREATE TABLE IF NOT EXISTS bee_tokens (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token_id       TEXT        NOT NULL UNIQUE,
  token_hash     TEXT        NOT NULL,
  salt           TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at   TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ,
  revoked_by     TEXT        CHECK (revoked_by IN ('self', 'member', 'colony', 'superseded')),
  client_version TEXT,
  created_ip     INET,
  CONSTRAINT bee_tokens_revocation_complete CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_bee_tokens_agent ON bee_tokens(agent_id);

-- AMENDMENT 1 (FIND-MIG-1) — one live token per agent, enforced by the schema.
-- A concurrent second activation fails here with a unique violation and rolls back its
-- own install-token consumption, so the race cannot leave two live tokens behind.
-- This index also serves every "find the live token for this agent" lookup, so the
-- non-unique partial index that stood here before it has been removed as redundant:
-- same column, same predicate.
CREATE UNIQUE INDEX IF NOT EXISTS bee_tokens_one_active_per_agent
  ON bee_tokens(agent_id) WHERE revoked_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2 · join_tokens (§9) — one-time install tokens, 30-minute TTL (§2)
-- ─────────────────────────────────────────────────────────────────────────────
-- Revocable while unconsumed (F11, dashboard action). 'self' and 'superseded' cannot
-- apply here: there is no bee holding this token and install tokens are not chained.
CREATE TABLE IF NOT EXISTS join_tokens (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  token_hash  TEXT        NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  revoked_by  TEXT        CHECK (revoked_by IN ('member', 'colony')),
  created_ip  INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT join_tokens_revocation_complete CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_join_tokens_agent   ON join_tokens(agent_id);
CREATE INDEX IF NOT EXISTS idx_join_tokens_expires ON join_tokens(expires_at) WHERE consumed_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3 · bee_client_events (§9, §6.12) — the audit trail
-- ─────────────────────────────────────────────────────────────────────────────
-- agent_id is deliberately NOT a foreign key. §9 marks agent_id as "FK" on the two token
-- tables and does not on this one, and the events need it that way: an auth_fail from an
-- IP has no known agent (NULL), and the audit trail must outlive a deleted agent row.
CREATE TABLE IF NOT EXISTS bee_client_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID,
  event       TEXT        NOT NULL CHECK (event IN (
                            'activate', 'revoke', 'awaken', 'heartbeat_flag', 'rate_limit',
                            'runaway', 'auth_fail', 'credential_in_chamber', 'adoption_l1',
                            'unreachable', 'unsent_replies')),
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip          INET,
  detail_json JSONB       NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_bee_client_events_agent ON bee_client_events(agent_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_bee_client_events_event ON bee_client_events(event, at DESC);
-- §6.8 runaway detection reads auth_fail by IP inside a 10-minute window.
CREATE INDEX IF NOT EXISTS idx_bee_client_events_ip    ON bee_client_events(ip, at DESC) WHERE ip IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4 · antenna_activate() (§6.5) — the whole activation in one transaction
-- ─────────────────────────────────────────────────────────────────────────────
-- Order is fixed by §6.5: (i) consume the install token, (ii) supersede any live token
-- for that agent, (iii) insert the new one, (iv) write the activate event (§6.12).
-- Zero rows on the conditional UPDATE raises SQLSTATE P0410, which the route maps to 410.
--
-- p_token_id (§6.5): token_id and secret are generated by the caller as a pair — the
-- caller must hold the plaintext to build the response bee_token — and this function
-- persists what it is given. bee_tokens.token_id is the lookup key the verifier (§6.6)
-- reads and cannot be derived from the other arguments.
CREATE OR REPLACE FUNCTION antenna_activate(
  p_install_hash   TEXT,
  p_token_id       TEXT,
  p_salt           TEXT,
  p_token_hash     TEXT,
  p_ip             INET,
  p_client_version TEXT
)
RETURNS TABLE (out_agent_id UUID, out_bee_token_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_agent_id     UUID;
  v_bee_token_id UUID;
BEGIN
  -- One conditional UPDATE. Consumed, expired, revoked or unknown all miss (§6.5, F6).
  UPDATE join_tokens
     SET consumed_at = now()
   WHERE token_hash  = p_install_hash
     AND consumed_at IS NULL
     AND revoked_at  IS NULL
     AND expires_at  > now()
  RETURNING join_tokens.agent_id INTO v_agent_id;

  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'antenna_activate: install token unknown, consumed, expired, or revoked'
      USING ERRCODE = 'P0410';
  END IF;

  -- AMENDMENT 2 (FIND-MIG-1) — supersede BEFORE the insert. Two clients, one bee (§11):
  -- the older token is revoked here, and its writes fail closed at the verifier from this
  -- moment. Doing this first is what lets bee_tokens_one_active_per_agent hold: the agent
  -- has zero live tokens at the instant the new row goes in. No id <> new.id clause is
  -- needed or possible, because the new row does not exist yet.
  UPDATE bee_tokens
     SET revoked_at = now(),
         revoked_by = 'superseded'
   WHERE bee_tokens.agent_id     = v_agent_id
     AND bee_tokens.revoked_at IS NULL;

  INSERT INTO bee_tokens (agent_id, token_id, token_hash, salt, client_version, created_ip)
  VALUES (v_agent_id, p_token_id, p_token_hash, p_salt, p_client_version, p_ip)
  RETURNING bee_tokens.id INTO v_bee_token_id;

  -- §6.12: every activation is an event row, written in the same transaction.
  INSERT INTO bee_client_events (agent_id, event, ip, detail_json)
  VALUES (v_agent_id, 'activate', p_ip,
          jsonb_build_object('bee_token_id', v_bee_token_id, 'client_version', p_client_version));

  RETURN QUERY SELECT v_agent_id, v_bee_token_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5 · RLS: enabled, zero policies (§9)
-- ─────────────────────────────────────────────────────────────────────────────
-- No CREATE POLICY statement appears in this file, by design. With RLS on and no
-- policies, every role without BYPASSRLS reads and writes nothing.
ALTER TABLE bee_tokens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE join_tokens       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bee_client_events ENABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6 · Grants (§9)
-- ─────────────────────────────────────────────────────────────────────────────
REVOKE ALL ON TABLE bee_tokens        FROM anon, authenticated;
REVOKE ALL ON TABLE join_tokens       FROM anon, authenticated;
REVOKE ALL ON TABLE bee_client_events FROM anon, authenticated;

-- "Nothing reaches these tables except the service role" (§9).
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE bee_tokens        TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE join_tokens       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE bee_client_events TO service_role;

-- SECURITY DEFINER function: service role only (§9).
REVOKE ALL ON FUNCTION antenna_activate(TEXT, TEXT, TEXT, TEXT, INET, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION antenna_activate(TEXT, TEXT, TEXT, TEXT, INET, TEXT)
  TO service_role;
