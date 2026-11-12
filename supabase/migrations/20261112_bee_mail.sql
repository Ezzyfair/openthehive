-- Migration: bee_mail, and the two event values the mail lane writes
-- For: XI-1 v0.4 DESIGN BRIEF v1.1 §3, §7.19 · ANTENNA-006 item 8
-- Ticket: ANTENNA-006
-- Date: November 12, 2026
-- Run in: Supabase SQL editor — AFTER Nikita's review. NOT RUN. No deploy runs this file.
-- Rollback: 20261112_bee_mail_rollback.sql (sibling, same directory)
--
-- WHY. Every mail a bee sends or reads is a row: the colony keeps the sha of the
-- body, never the body (§3). /api/bee/mail/send writes one 'out' row per send,
-- refused or not; /api/bee/mail writes one 'in' row per provider message on first
-- delivery. The partial unique index turns a second delivery of the same provider
-- message into 23505, which the route reads as "already recorded".
--
-- This file does three things, in order:
--
--   1. Creates bee_mail with exactly the brief's columns, and no others.
--   2. Adds the partial unique index on (agent_id, direction, provider_id).
--   3. Widens the bee_client_events.event CHECK by exactly 'mail_sent' and
--      'mail_refused', after the 20261107_human_paired.sql precedent (drop the
--      named constraint, add it back with the full list).
--
-- BEFORE RUNNING: the CHECK re-add fails if any existing row carries an event
-- outside the current list. This must return 0:
--
--   SELECT count(*) FROM bee_client_events
--    WHERE event NOT IN (
--      'activate', 'revoke', 'awaken', 'heartbeat_flag', 'rate_limit',
--      'runaway', 'auth_fail', 'credential_in_chamber', 'adoption_l1',
--      'human_paired', 'unreachable', 'unsent_replies');
--
-- POSTURE: bee_mail is service-role only. RLS enabled with no policies, every
-- privilege revoked from anon and authenticated, as bee_client_events is.

CREATE TABLE IF NOT EXISTS bee_mail (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id       uuid        NOT NULL REFERENCES agents(id),
  direction      text        NOT NULL CHECK (direction IN ('in', 'out')),
  to_json        jsonb,
  subject        text,
  body_sha256    text,
  provider_id    text,
  at             timestamptz NOT NULL DEFAULT now(),
  refused_reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS bee_mail_one_per_provider_message
  ON bee_mail(agent_id, direction, provider_id)
  WHERE provider_id IS NOT NULL;

ALTER TABLE bee_mail ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE bee_mail FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE bee_mail TO service_role;

ALTER TABLE bee_client_events DROP CONSTRAINT IF EXISTS bee_client_events_event_check;
ALTER TABLE bee_client_events
  ADD CONSTRAINT bee_client_events_event_check CHECK (event IN (
    'activate', 'revoke', 'awaken', 'heartbeat_flag', 'rate_limit',
    'runaway', 'auth_fail', 'credential_in_chamber', 'adoption_l1',
    'human_paired', 'unreachable', 'unsent_replies',
    'mail_sent', 'mail_refused'));
