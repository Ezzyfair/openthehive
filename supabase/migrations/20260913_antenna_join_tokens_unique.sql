-- Migration: at most one open install token per agent
-- For: XI-1 ANTENNA DESIGN v0.2.2 §2, F11 · NIK-ANTENNA-004c FIND-MIG-JT
-- Ticket: NIK-ANTENNA-005b
-- Date: September 13, 2026
-- Run in: Supabase SQL editor — AFTER Nikita's review. NOT RUN. No deploy runs this file.
-- Rollback: 20260913_antenna_join_tokens_unique_rollback.sql (sibling, same directory)
--
-- WHY. issueInstallToken() revokes the agent's prior unconsumed token and then
-- inserts a new one. That is two statements, and between them there is a window:
-- two concurrent issues can both revoke, both insert, and leave the agent holding
-- TWO live install tokens. Each is single-use and 30-minute, so the blast radius
-- is small — but "one live install token per bee" is a property the design states,
-- and a property enforced only by the order of two statements is not enforced.
--
-- The same shape as bee_tokens_one_active_per_agent: the invariant becomes a
-- schema property, the loser of a race fails with 23505, and the route maps that
-- to 409 with a retry hint rather than pretending it succeeded.
--
-- CONSUMED AND REVOKED ROWS ARE OUTSIDE THE INDEX. They are the audit trail of
-- past activations (§6.12) and there can be any number of them per agent. Only
-- the open ones — unconsumed and unrevoked — are constrained.
--
-- BEFORE RUNNING: if any agent already holds more than one open install token the
-- index build fails. This finds them, and they should be revoked, not deleted:
--
--   SELECT agent_id, count(*)
--     FROM join_tokens
--    WHERE consumed_at IS NULL AND revoked_at IS NULL
--    GROUP BY agent_id
--   HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS join_tokens_one_open_per_agent
  ON join_tokens(agent_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
