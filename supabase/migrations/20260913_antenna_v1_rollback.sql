-- Rollback: Antenna v1
-- Undoes: 20260913_antenna_v1.sql (sibling, same directory)
-- For: XI-1 ANTENNA DESIGN v0.2.2 §9 — "Migration ships with its rollback file"
-- Ticket: NIK-ANTENNA-003 (PASSed Sept 13, 2026, FIND-MIG-1 applied)
-- Date: September 13, 2026
-- Run in: Supabase SQL editor.
--
-- DESTRUCTIVE. Dropping these tables destroys every bee token, every install token,
-- and the whole Antenna audit trail (§6.12). Any bee still running Antenna keeps a
-- token in its hive.json that no longer resolves; its next poll fails closed at the
-- verifier and the client stops. Export bee_client_events before running this if the
-- audit trail matters.
--
-- Order is the reverse of creation. No CASCADE: if something outside this migration has
-- come to depend on these objects, the DROP should fail loudly rather than take the
-- dependent object with it.

-- 1 · the function first — it depends on all three tables
DROP FUNCTION IF EXISTS antenna_activate(TEXT, TEXT, TEXT, TEXT, INET, TEXT);

-- 2 · tables. Indexes, constraints, RLS state and grants all go with them — including
--     bee_tokens_one_active_per_agent, which needs no DROP INDEX of its own.
DROP TABLE IF EXISTS bee_client_events;
DROP TABLE IF EXISTS join_tokens;
DROP TABLE IF EXISTS bee_tokens;

-- Nothing else to undo: the forward migration created no PG ENUM types, altered no
-- existing table, and added no column to agents. The FKs live on the dropped tables,
-- so agents is untouched by both directions.
