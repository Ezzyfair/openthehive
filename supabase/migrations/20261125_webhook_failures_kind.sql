-- Migration: stripe_webhook_failures.kind — which rows are failures and which are to-dos
-- For: NIK-MEMBER-UPSERT-001 MED-1 (Nikita), accepted by Francis Tue Nov 24, 2026
-- Ticket: MEMBER-UPSERT-001-b (item 6)
-- Date: November 25, 2026
-- Run in: Supabase SQL editor — AFTER Nikita's review. NOT RUN by the build.
-- Rollback: 20261125_webhook_failures_kind_rollback.sql (sibling, same directory)
--
-- RUN THIS BEFORE THE CODE DEPLOYS. The handler writes kind = 'todo' on the to-do row
-- an upgrade leaves (reason 'upgrade_old_subscription_open'). Without the column that
-- insert is refused, the refusal is swallowed by design, and the hourly alert would
-- have no row to repeat.
--
-- One added column with a default: every existing insert that names no kind keeps
-- working and reads 'failure'. The UPDATE marks the to-do rows already written.
--
-- No CHECK on kind, for the reason the first migration gives for reason: a refused
-- insert on this table would lose the only record of the event.
--
-- The last statement is the check. It returns one row: failures, todos, other.
-- other must read 0.

BEGIN;
ALTER TABLE stripe_webhook_failures ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'failure';
UPDATE stripe_webhook_failures SET kind = 'todo' WHERE reason = 'upgrade_old_subscription_open';
COMMIT;

SELECT count(*) FILTER (WHERE kind = 'failure') AS failures, count(*) FILTER (WHERE kind = 'todo') AS todos, count(*) FILTER (WHERE kind NOT IN ('failure', 'todo')) AS other FROM stripe_webhook_failures;
