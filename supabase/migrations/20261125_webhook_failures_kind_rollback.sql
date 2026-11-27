-- Rollback: stripe_webhook_failures.kind
-- Undoes: 20261125_webhook_failures_kind.sql (sibling, same directory)
-- Ticket: MEMBER-UPSERT-001-b (item 6; NIK-MEMBER-UPSERT-001 MED-1)
-- Date: November 25, 2026
-- Run in: Supabase SQL editor — AFTER Nikita's review. NOT RUN by the build.
--
-- REVERT THE CODE FIRST, then run this. The reverted handler names no kind, so the
-- column can go without refusing any insert. The rows stay; only the column that told
-- failures from to-dos is dropped, and they are told apart by reason again.
--
-- The last statement is the check. It returns one row: kind_columns, which must read 0.

BEGIN;
ALTER TABLE stripe_webhook_failures DROP COLUMN IF EXISTS kind;
COMMIT;

SELECT count(*) AS kind_columns FROM information_schema.columns WHERE table_name = 'stripe_webhook_failures' AND column_name = 'kind';
