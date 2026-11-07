-- Migration: one human_paired row per bee (and the event value it needs)
-- For: XI-1 ANTENNA DESIGN §6.12, §9 · ANTENNA-003 ruling 5 (pairing, the bee's own act)
-- Ticket: ANTENNA-003
-- Date: November 7, 2026
-- Run in: Supabase SQL editor — AFTER Nikita's review. NOT RUN. No deploy runs this file.
-- Rollback: 20261107_human_paired_rollback.sql (sibling, same directory)
--
-- WHY. Pairing is a STATE, not an event stream: a bee's human either is the human
-- lane in its chamber or is not. The bee records it once, by its own hand, after it
-- asked its human on their own channel and heard yes (ruling 5). /api/bee/heartbeat
-- turns the `human_paired` flag into one bee_client_events row and must never
-- accumulate a second for the same bee — a restarted client replays its flags, and
-- two ticks can be in flight at once.
--
-- This file does two things, in order:
--
--   1. Widens the bee_client_events.event CHECK to admit 'human_paired'. The value
--      is new; without this the insert fails the constraint and the heartbeat logs
--      a 'failed' outcome (still 200, by design). The original constraint is unnamed
--      (inline in CREATE TABLE, 20260913_antenna_v1.sql), so it carries Postgres's
--      generated name bee_client_events_event_check; this drops that and adds a
--      named one carrying the full list plus the new value.
--
--   2. Adds a PARTIAL UNIQUE INDEX so a racing second insert raises 23505, which
--      recordHumanPairedOnce reports as 'already'. The same move as
--      bee_client_events_one_adoption_per_agent.
--
-- WHY THE SERVER DOES NOT DEPEND ON THE INDEX. recordHumanPairedOnce looks for an
-- existing row before it inserts, so idempotency holds even on a database where this
-- index was never built. The index closes the narrow race between that look and the
-- insert; it is belt-and-braces, not the whole guarantee. That is deliberate: the
-- heartbeat had to be idempotent before this migration was so much as reviewed.
--
-- WHY PARTIAL. bee_client_events holds every other event type for the same agent —
-- poll rate limits, auth failures, heartbeat flags, adoptions — and there can be any
-- number of those per bee. Only human_paired is constrained here. agent_id is
-- nullable and Postgres treats NULLs as distinct in a unique index, so NULL rows are
-- unaffected; a human_paired row always carries an agent_id (the verifier resolved
-- the bee before the handler ran).
--
-- BEFORE RUNNING: the index build fails if any bee already holds more than one
-- human_paired row. This finds them. Keep the EARLIEST and delete the rest:
--
--   SELECT agent_id, count(*), min(at) AS first_paired, max(at) AS last_duplicate
--     FROM bee_client_events
--    WHERE event = 'human_paired'
--    GROUP BY agent_id
--   HAVING count(*) > 1
--    ORDER BY count(*) DESC;
--
-- POSTURE: this file changes a constraint and adds an index on an existing table.
-- bee_client_events already has RLS enabled with zero policies, REVOKE ALL FROM
-- anon, authenticated, and an explicit GRANT to service_role (20260913_antenna_v1.sql).
-- A constraint and an index inherit the table's access rules, so there is nothing to
-- re-grant. The RLS/GRANT statements below re-assert that posture idempotently.

ALTER TABLE bee_client_events DROP CONSTRAINT IF EXISTS bee_client_events_event_check;
ALTER TABLE bee_client_events
  ADD CONSTRAINT bee_client_events_event_check CHECK (event IN (
    'activate', 'revoke', 'awaken', 'heartbeat_flag', 'rate_limit',
    'runaway', 'auth_fail', 'credential_in_chamber', 'adoption_l1',
    'human_paired', 'unreachable', 'unsent_replies'));

CREATE UNIQUE INDEX IF NOT EXISTS bee_client_events_one_pairing_per_agent
  ON bee_client_events(agent_id)
  WHERE event = 'human_paired';

-- Re-assertion, not a change. Safe to run twice.
ALTER TABLE bee_client_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bee_client_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE bee_client_events TO service_role;
