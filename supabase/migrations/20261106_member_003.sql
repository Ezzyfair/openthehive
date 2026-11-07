-- Migration: MEMBER-003 — a Scout's human is a member from day one
-- Issued: 2026-11-06 (night build NIGHT-BUILD-003, branch member-v3)
-- Rollback: 20261106_member_003_rollback.sql (sibling, same directory)
--
-- STATUS: PROPOSED, NOT APPLIED. Per the ticket rule, no migration is run by the
-- build. Nikita rules on it; Francis runs it in the SQL editor with the rollback in
-- HIVE-CANON BEFORE the merge. The code is written to work both before and after it
-- where possible (the Scout members upsert is non-fatal, so registration survives a
-- NOT NULL that this migration would relax).
--
-- ───────────────────────────────────────────────────────────────────────────
-- WHY (item 1, MED-1)
-- ───────────────────────────────────────────────────────────────────────────
-- app/api/agents/register/route.ts now creates a `members` row for a Scout's human,
-- linked to the agent (members.agent_id → agents.id), so the welcome's "sign in at
-- /member/login" resolves (lib/antenna/member.ts joins auth email → members.email →
-- members.agent_id). A Scout has NO Stripe customer yet, so that row carries a null
-- stripe_customer_id and stripe_subscription_id until the human actually pays (the
-- checkout upsert in lib/rail/webhook-handler.ts then fills them on this same email
-- row via onConflict 'email').
--
-- The base `members` DDL predates every migration in this directory, so this file
-- cannot see whether the Stripe columns are declared NOT NULL. The paid path has
-- always written them, so a NOT NULL is plausible. If one exists, the Scout insert
-- fails until it is relaxed. ALTER … DROP NOT NULL is idempotent — a no-op if the
-- column is already nullable — so this is safe to apply either way.
--
-- No CHECK/ENUM on members.tier (confirmed by 20260922_tier_canonical.sql: "NO CHECK
-- CONSTRAINT OR ENUM WAS FOUND"), so tier = 'scout' needs no change.

ALTER TABLE members ALTER COLUMN stripe_customer_id     DROP NOT NULL;
ALTER TABLE members ALTER COLUMN stripe_subscription_id DROP NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- WHY (item 5, LOW-2) — the email_sends race
-- ───────────────────────────────────────────────────────────────────────────
-- sendWelcomeOnce (lib/email/welcome.ts) reads email_sends for a prior 'sent' row of
-- the welcome template before sending. Two concurrent creations for the same address
-- (Scout path and a near-simultaneous checkout) can both read "none" and both send.
-- The code keeps its fail-closed read; this index is the durable fix underneath it.
--
-- PARTIAL on status = 'sent': email_sends logs every ATTEMPT (sent, skipped_no_env,
-- suppressed, …) and legitimately holds several rows per (address, template). The
-- guarantee we want is "at most one SENT welcome per address", not "at most one row".
-- lower(to_email) matches how welcome.ts normalises the address before it reads.
--
-- NOTE for the operator: if two 'sent' rows for the same (lower(to_email), template)
-- already exist in production, CREATE UNIQUE INDEX will fail until the duplicate is
-- resolved. Check first:
--   SELECT lower(to_email), template, count(*) FROM email_sends
--   WHERE status = 'sent' GROUP BY 1, 2 HAVING count(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS email_sends_sent_once_per_template
  ON email_sends (lower(to_email), template)
  WHERE status = 'sent';
