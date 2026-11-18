-- Migration: wingmate_pairs, the five room functions, and the two event values the room lane writes
-- For: XI-1 v0.4 DESIGN BRIEF v1.1 §4, §7.15, §7.19 · NIK-XI1-V04-DESIGN-v1_1 N6 · ANTENNA-007 item 2
-- Ticket: ANTENNA-007
-- Date: November 14, 2026
-- Run in: Supabase SQL editor — AFTER Nikita's review. NOT RUN. No deploy runs this file.
-- Rollback: 20261114_rooms_rollback.sql (sibling, same directory)
--
-- WHY. A bee reaches colony rooms through its token (room.poll, room.post). Its
-- wingmate and swarm rooms are private: type 'wingmate' / 'swarm', never 'hive',
-- because hive_honeycomb_ids() opens every hive/active room to every member. Who is
-- in such a room is its honeycomb_members rows, and R22 fixes them exactly. These
-- five functions are the ONE place those rows are written (N6); the flight engine
-- and the beekeeper call them, nothing else inserts or deletes membership for these
-- two room types.
--
-- This file does four things, in order:
--
--   1. Creates wingmate_pairs with exactly the brief's columns, and no others.
--   2. Adds two partial unique indexes: a bee holds at most one open pair, on
--      either side.
--   3. Creates wingmate_open, wingmate_fill, wingmate_release, swarm_open and
--      swarm_close — plpgsql, revoked from public, anon and authenticated, granted
--      to service_role only. Each raises, changing nothing, when a precondition fails.
--   4. Widens the bee_client_events.event CHECK by exactly 'room_post' and
--      'room_choice', after the 20261112_bee_mail.sql precedent.
--
-- honeycomb_members: its unique constraints are unknown, so nothing here uses
-- ON CONFLICT against it. Every insert is either into a honeycomb this same call
-- created, or guarded by NOT EXISTS.
--
-- BEFORE RUNNING: the CHECK re-add fails if any existing row carries an event
-- outside the current list. This must return 0:
--
--   SELECT count(*) FROM bee_client_events
--    WHERE event NOT IN (
--      'activate', 'revoke', 'awaken', 'heartbeat_flag', 'rate_limit',
--      'runaway', 'auth_fail', 'credential_in_chamber', 'adoption_l1',
--      'human_paired', 'unreachable', 'unsent_replies',
--      'mail_sent', 'mail_refused');
--
-- POSTURE: wingmate_pairs is service-role only. RLS enabled with no policies, every
-- privilege revoked from anon and authenticated, as bee_mail is.

-- ── 1 · the table ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS wingmate_pairs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_a        uuid        NOT NULL REFERENCES agents(id),
  agent_b        uuid        REFERENCES agents(id),
  honeycomb_id   uuid        NOT NULL REFERENCES honeycombs(id),
  bonded_at      timestamptz NOT NULL DEFAULT now(),
  released_at    timestamptz,
  release_reason text,
  elder_standin  boolean     NOT NULL DEFAULT false
);

-- ── 2 · one open pair per bee ─────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS wingmate_pairs_one_open_agent_a
  ON wingmate_pairs(agent_a)
  WHERE released_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS wingmate_pairs_one_open_agent_b
  ON wingmate_pairs(agent_b)
  WHERE released_at IS NULL AND agent_b IS NOT NULL;

ALTER TABLE wingmate_pairs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE wingmate_pairs FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE wingmate_pairs TO service_role;

-- ── 3 · the five functions ────────────────────────────────────────────────────
--
-- Each takes a transaction-scoped advisory lock on one key before it reads, so two
-- calls cannot both see "no open pair" for the same bee and both insert (the two
-- partial indexes cover each column alone, not a bee that is agent_a in one pair
-- and agent_b in another).

-- wingmate_open — a room for one bee and its partner: a second bee, or an Elder
-- standing in until that bee arrives. Exactly two membership rows, role 'member'.
-- p_creator is the staff agent that opens the room; it gets no membership row.
CREATE OR REPLACE FUNCTION wingmate_open(
  p_agent_a          uuid,
  p_partner          uuid,
  p_partner_is_elder boolean,
  p_creator          uuid
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_honeycomb uuid;
  v_pair      uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('wingmate_pairs'));

  IF p_agent_a IS NULL OR p_partner IS NULL OR p_partner_is_elder IS NULL OR p_creator IS NULL THEN
    RAISE EXCEPTION 'wingmate_open: every argument is required';
  END IF;
  IF p_agent_a = p_partner THEN
    RAISE EXCEPTION 'wingmate_open: a bee cannot be its own wingmate';
  END IF;
  IF p_creator = p_agent_a OR p_creator = p_partner THEN
    RAISE EXCEPTION 'wingmate_open: the creator is never one of the two members';
  END IF;
  IF EXISTS (
    SELECT 1 FROM wingmate_pairs
     WHERE released_at IS NULL AND (agent_a = p_agent_a OR agent_b = p_agent_a)
  ) THEN
    RAISE EXCEPTION 'wingmate_open: % already has an open pair', p_agent_a;
  END IF;
  IF NOT p_partner_is_elder AND EXISTS (
    SELECT 1 FROM wingmate_pairs
     WHERE released_at IS NULL AND (agent_a = p_partner OR agent_b = p_partner)
  ) THEN
    RAISE EXCEPTION 'wingmate_open: % already has an open pair', p_partner;
  END IF;

  INSERT INTO honeycombs (title, type, status, creator_id)
  VALUES ('Wingmates', 'wingmate', 'active', p_creator)
  RETURNING id INTO v_honeycomb;

  -- A honeycomb created one statement ago has no membership rows; no conflict is possible.
  INSERT INTO honeycomb_members (honeycomb_id, agent_id, role)
  VALUES (v_honeycomb, p_agent_a, 'member'),
         (v_honeycomb, p_partner, 'member');

  IF p_partner_is_elder THEN
    INSERT INTO wingmate_pairs (agent_a, agent_b, honeycomb_id, elder_standin)
    VALUES (p_agent_a, NULL, v_honeycomb, true)
    RETURNING id INTO v_pair;
  ELSE
    INSERT INTO wingmate_pairs (agent_a, agent_b, honeycomb_id, elder_standin)
    VALUES (p_agent_a, p_partner, v_honeycomb, false)
    RETURNING id INTO v_pair;
  END IF;

  RETURN v_pair;
END;
$$;

-- wingmate_fill — the second bee arrives. The Elder's row is deleted, the bee's row
-- inserted; the room ends with exactly two membership rows: the two bees.
CREATE OR REPLACE FUNCTION wingmate_fill(
  p_pair    uuid,
  p_agent_b uuid,
  p_elder   uuid
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row   wingmate_pairs%ROWTYPE;
  v_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('wingmate_pairs'));

  IF p_pair IS NULL OR p_agent_b IS NULL OR p_elder IS NULL THEN
    RAISE EXCEPTION 'wingmate_fill: every argument is required';
  END IF;

  SELECT * INTO v_row FROM wingmate_pairs WHERE id = p_pair FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wingmate_fill: no such pair %', p_pair;
  END IF;
  IF v_row.released_at IS NOT NULL OR v_row.elder_standin IS NOT TRUE THEN
    RAISE EXCEPTION 'wingmate_fill: pair % is not open with an Elder standing in', p_pair;
  END IF;
  IF p_agent_b = v_row.agent_a OR p_elder = v_row.agent_a OR p_agent_b = p_elder THEN
    RAISE EXCEPTION 'wingmate_fill: the three agents must be distinct';
  END IF;
  IF EXISTS (
    SELECT 1 FROM wingmate_pairs
     WHERE released_at IS NULL AND (agent_a = p_agent_b OR agent_b = p_agent_b)
  ) THEN
    RAISE EXCEPTION 'wingmate_fill: % already has an open pair', p_agent_b;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM honeycomb_members
     WHERE honeycomb_id = v_row.honeycomb_id AND agent_id = p_elder
  ) THEN
    RAISE EXCEPTION 'wingmate_fill: % is not standing in for pair %', p_elder, p_pair;
  END IF;

  DELETE FROM honeycomb_members
   WHERE honeycomb_id = v_row.honeycomb_id AND agent_id = p_elder;

  INSERT INTO honeycomb_members (honeycomb_id, agent_id, role)
  SELECT v_row.honeycomb_id, p_agent_b, 'member'
   WHERE NOT EXISTS (
     SELECT 1 FROM honeycomb_members
      WHERE honeycomb_id = v_row.honeycomb_id AND agent_id = p_agent_b
   );

  UPDATE wingmate_pairs
     SET agent_b = p_agent_b, elder_standin = false
   WHERE id = p_pair;

  SELECT count(*) INTO v_count FROM honeycomb_members WHERE honeycomb_id = v_row.honeycomb_id;
  IF v_count <> 2 OR NOT EXISTS (
       SELECT 1 FROM honeycomb_members WHERE honeycomb_id = v_row.honeycomb_id AND agent_id = v_row.agent_a
     ) THEN
    RAISE EXCEPTION 'wingmate_fill: room % would not hold exactly the two bees', v_row.honeycomb_id;
  END IF;
END;
$$;

-- wingmate_release — the pair ends. The room becomes read_only; membership stays.
CREATE OR REPLACE FUNCTION wingmate_release(
  p_pair   uuid,
  p_reason text
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_row wingmate_pairs%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('wingmate_pairs'));

  IF p_pair IS NULL THEN
    RAISE EXCEPTION 'wingmate_release: the pair is required';
  END IF;

  SELECT * INTO v_row FROM wingmate_pairs WHERE id = p_pair FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'wingmate_release: no such pair %', p_pair;
  END IF;
  IF v_row.released_at IS NOT NULL THEN
    RAISE EXCEPTION 'wingmate_release: pair % is already released', p_pair;
  END IF;

  UPDATE wingmate_pairs
     SET released_at = now(), release_reason = p_reason
   WHERE id = p_pair;

  UPDATE honeycombs
     SET status = 'read_only'
   WHERE id = v_row.honeycomb_id;
END;
$$;

-- swarm_open — a room for a bee that hit a wall and the helpers the colony calls.
-- The wall is the room's description, verbatim. One 'member' row for the asking bee
-- and one for each distinct helper that is not the asking bee; none for p_creator.
CREATE OR REPLACE FUNCTION swarm_open(
  p_asking  uuid,
  p_wall    text,
  p_helpers uuid[],
  p_creator uuid
) RETURNS uuid
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_honeycomb uuid;
BEGIN
  IF p_asking IS NULL OR p_wall IS NULL OR p_creator IS NULL THEN
    RAISE EXCEPTION 'swarm_open: the asking bee, the wall and the creator are required';
  END IF;

  INSERT INTO honeycombs (title, description, type, status, creator_id)
  VALUES ('Swarm Call', p_wall, 'swarm', 'active', p_creator)
  RETURNING id INTO v_honeycomb;

  -- A honeycomb created one statement ago has no membership rows; no conflict is possible.
  INSERT INTO honeycomb_members (honeycomb_id, agent_id, role)
  VALUES (v_honeycomb, p_asking, 'member');

  INSERT INTO honeycomb_members (honeycomb_id, agent_id, role)
  SELECT DISTINCT v_honeycomb, h, 'member'
    FROM unnest(coalesce(p_helpers, ARRAY[]::uuid[])) AS h
   WHERE h IS NOT NULL AND h <> p_asking;

  RETURN v_honeycomb;
END;
$$;

-- swarm_close — the call is over. The room is archived and leaves every list.
CREATE OR REPLACE FUNCTION swarm_close(
  p_honeycomb uuid
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_honeycomb IS NULL OR NOT EXISTS (
    SELECT 1 FROM honeycombs WHERE id = p_honeycomb AND type = 'swarm'
  ) THEN
    RAISE EXCEPTION 'swarm_close: % is not a swarm room', p_honeycomb;
  END IF;

  UPDATE honeycombs SET status = 'archived' WHERE id = p_honeycomb;
END;
$$;

REVOKE ALL ON FUNCTION wingmate_open(uuid, uuid, boolean, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION wingmate_fill(uuid, uuid, uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION wingmate_release(uuid, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION swarm_open(uuid, text, uuid[], uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION swarm_close(uuid) FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION wingmate_open(uuid, uuid, boolean, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION wingmate_fill(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION wingmate_release(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION swarm_open(uuid, text, uuid[], uuid) TO service_role;
GRANT EXECUTE ON FUNCTION swarm_close(uuid) TO service_role;

-- ── 4 · the two event values ──────────────────────────────────────────────────

ALTER TABLE bee_client_events DROP CONSTRAINT IF EXISTS bee_client_events_event_check;
ALTER TABLE bee_client_events
  ADD CONSTRAINT bee_client_events_event_check CHECK (event IN (
    'activate', 'revoke', 'awaken', 'heartbeat_flag', 'rate_limit',
    'runaway', 'auth_fail', 'credential_in_chamber', 'adoption_l1',
    'human_paired', 'unreachable', 'unsent_replies',
    'mail_sent', 'mail_refused',
    'room_post', 'room_choice'));
