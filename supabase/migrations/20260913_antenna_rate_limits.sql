-- Migration: Antenna rate-limit storage
-- For: XI-1 ANTENNA DESIGN v0.2.2 §6.7 — "rate limits on every endpoint, keyed per
--      token (or per IP where no token), returned as 429 with Retry-After".
-- Ticket: NIK-ANTENNA-004a · build order §13 step 2
-- Date: September 13, 2026
-- Run in: Supabase SQL editor — AFTER Nikita's review. NOT RUN. No deploy runs this file.
-- Rollback: 20260913_antenna_rate_limits_rollback.sql (sibling, same directory)
--
-- WHY A TABLE. /api/bee/* runs on Vercel Functions across reused instances and
-- several regions. An in-process counter would be per-instance, so the real ceiling
-- would be (limit x instances) and would drift with traffic. A shared counter is the
-- only way the numbers in §5.1 mean what they say.
--
-- Fixed window, not sliding: one row per (scope, identity, window). A burst can cross
-- a window boundary and get up to 2x the limit in adjacent seconds. That is accepted
-- for v1 — §6.8's runaway rule is what catches sustained abuse, and it fires below the
-- ceiling. A sliding window is a v1.1 change to this one function.
--
-- POSTURE: same as the other three Antenna tables — RLS enabled, zero policies,
-- REVOKE from anon/authenticated, explicit GRANT to service_role. RLS is not FORCEd,
-- because antenna_rate_hit() is SECURITY DEFINER and writes as the table owner.

CREATE TABLE IF NOT EXISTS bee_rate_limits (
  bucket_key   TEXT        PRIMARY KEY,
  hits         INTEGER     NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL
);

-- Supports the prune below. Rows are worthless the moment their window closes.
CREATE INDEX IF NOT EXISTS idx_bee_rate_limits_expires ON bee_rate_limits(expires_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- antenna_rate_hit() — count this request and say whether it is allowed
-- ─────────────────────────────────────────────────────────────────────────────
-- One statement does the counting. INSERT ... ON CONFLICT DO UPDATE is atomic, so
-- concurrent requests in the same window cannot both read the same pre-increment
-- value. The caller passes the window it computed; the function never invents one,
-- which keeps the arithmetic in one place and testable from the app side.
CREATE OR REPLACE FUNCTION antenna_rate_hit(
  p_bucket_key   TEXT,
  p_window_start TIMESTAMPTZ,
  p_expires_at   TIMESTAMPTZ,
  p_limit        INTEGER
)
RETURNS TABLE (out_hits INTEGER, out_allowed BOOLEAN, out_retry_after INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_hits INTEGER;
BEGIN
  INSERT INTO bee_rate_limits (bucket_key, hits, window_start, expires_at)
  VALUES (p_bucket_key, 1, p_window_start, p_expires_at)
  ON CONFLICT (bucket_key) DO UPDATE
    SET hits = bee_rate_limits.hits + 1
  RETURNING bee_rate_limits.hits INTO v_hits;

  RETURN QUERY SELECT
    v_hits,
    (v_hits <= p_limit),
    GREATEST(1, CEIL(EXTRACT(EPOCH FROM (p_expires_at - now())))::INTEGER);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- antenna_rate_prune() — housekeeping
-- ─────────────────────────────────────────────────────────────────────────────
-- Nothing calls this on the request path. Run it from a scheduled job, or by hand;
-- the table is harmless but grows without it. Returns the number of rows removed.
CREATE OR REPLACE FUNCTION antenna_rate_prune()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM bee_rate_limits WHERE expires_at < now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS and grants — same posture as the other Antenna tables (§9)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE bee_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE bee_rate_limits FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE bee_rate_limits TO service_role;

REVOKE ALL ON FUNCTION antenna_rate_hit(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION antenna_rate_hit(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION antenna_rate_prune() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION antenna_rate_prune() TO service_role;
