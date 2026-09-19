-- Rollback: at most one open install token per agent
-- Undoes: 20260913_antenna_join_tokens_unique.sql (sibling, same directory)
-- For: XI-1 ANTENNA DESIGN v0.2.2 §2, F11 · NIK-ANTENNA-004c FIND-MIG-JT
-- Ticket: NIK-ANTENNA-005b
-- Date: September 13, 2026
-- Run in: Supabase SQL editor.
--
-- Non-destructive: drops an index, touches no row. After this the "one open
-- install token per agent" invariant is back to being enforced only by the order
-- of two statements in issueInstallToken(), which is the gap this index closed.
-- /api/member/join-tokens/issue keeps its 409 mapping; it simply stops firing.

DROP INDEX IF EXISTS join_tokens_one_open_per_agent;
