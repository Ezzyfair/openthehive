-- Rollback: Antenna rate-limit storage
-- Undoes: 20260913_antenna_rate_limits.sql (sibling, same directory)
-- For: XI-1 ANTENNA DESIGN v0.2.2 §6.7
-- Ticket: NIK-ANTENNA-004a
-- Date: September 13, 2026
-- Run in: Supabase SQL editor.
--
-- Safe to run: bee_rate_limits holds only in-flight counters, never anything of
-- record. Dropping it forgets who is mid-window, so a caller could get a fresh
-- allowance immediately after. Nothing auditable is lost — the rate_limit and
-- runaway rows live in bee_client_events, which this file does not touch.
--
-- NOTE: with the table gone, lib/antenna/rate-limit.ts fails closed and every
-- rate-limited endpoint answers 503. That is deliberate (see that file), but it
-- means this rollback takes /api/bee/* down until the forward migration is re-run.

DROP FUNCTION IF EXISTS antenna_rate_prune();
DROP FUNCTION IF EXISTS antenna_rate_hit(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER);
DROP TABLE IF EXISTS bee_rate_limits;
