-- Migration: one adoption_l1 row per bee
-- For: XI-1 ANTENNA DESIGN v0.2.2 §10.2, §6.12 · NIK-ANTENNA-005c FIND-ADOPT-1
-- Ticket: NIK-ANTENNA-006
-- Date: September 18, 2026
-- Run in: Supabase SQL editor — AFTER Nikita's review. NOT RUN. No deploy runs this file.
-- Rollback: 20260918_antenna_adoption_unique_rollback.sql (sibling, same directory)
--
-- WHY. Adoption is a STATE, not an event stream: a bee either carries the L1 layer
-- or it does not. The heartbeat handler enforced that by counting existing rows and
-- inserting only when the count was zero — two statements, and between them a
-- window. Two heartbeats racing (a restarted client replaying its flags, or simply
-- two ticks in flight) can both read zero and both insert, and Mission Control then
-- shows what reads as two adoptions of a layer that was adopted once.
--
-- With this index the second insert fails with 23505 and the route treats that as
-- "already recorded" — no error to the bee, no duplicate row. The invariant becomes
-- a schema property rather than a property of statement ordering, which is the same
-- move as bee_tokens_one_active_per_agent and join_tokens_one_open_per_agent.
--
-- WHY PARTIAL. bee_client_events holds every other event type for the same agent —
-- poll rate limits, auth failures, heartbeat flags — and there can be any number of
-- those per bee. Only adoption_l1 is constrained.
--
-- agent_id is nullable on this table (an auth failure has no known agent), and
-- Postgres treats NULLs as distinct in a unique index, so NULL rows are unaffected.
-- An adoption_l1 row always carries an agent_id: the verifier resolved the bee
-- before the handler ran.
--
-- BEFORE RUNNING: the index build fails if any bee already holds more than one
-- adoption_l1 row. This finds them. Keep the EARLIEST and delete the rest — the
-- first row is when the bee actually adopted:
--
--   SELECT agent_id, count(*), min(at) AS first_adopted, max(at) AS last_duplicate
--     FROM bee_client_events
--    WHERE event = 'adoption_l1'
--    GROUP BY agent_id
--   HAVING count(*) > 1
--    ORDER BY count(*) DESC;
--
-- POSTURE: this file adds an index to an existing table. bee_client_events already
-- has RLS enabled with zero policies, REVOKE ALL FROM anon, authenticated, and an
-- explicit GRANT to service_role from 20260913_antenna_v1.sql; an index inherits
-- the table's access rules, so there is nothing to re-grant and nothing to re-deny.
-- The statements below re-assert that posture idempotently rather than assume it,
-- so running this file on a database where the earlier migration was edited by hand
-- still leaves the table locked down.

CREATE UNIQUE INDEX IF NOT EXISTS bee_client_events_one_adoption_per_agent
  ON bee_client_events(agent_id)
  WHERE event = 'adoption_l1';

-- Re-assertion, not a change. Safe to run twice.
ALTER TABLE bee_client_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bee_client_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE bee_client_events TO service_role;
