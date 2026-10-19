-- Rollback for 20261018_skill_agent_wallet.sql — NIK-SKILL-WALLET-001
-- Date: October 18, 2026
-- Run in: Supabase SQL editor, as postgres.
--
-- Removes the one row the forward migration inserted, and nothing else. There is
-- nothing else to undo: that migration created no table, altered no column, added no
-- constraint and granted nothing.
--
-- DELETE BY SLUG, not by id, because the id is gen_random_uuid() and is therefore not
-- knowable from the migration file — which is also why the forward file's guard reads
-- the slug rather than the id.
--
-- WHAT THIS DOES NOT UNDO: if a bee has already read the skill, or an Elder has
-- verified a custody plan against it, those events live in other tables and are not
-- touched here. Deleting the row removes the skill from the vault, not the history of
-- anyone having used it. If skill_masteries or a cohort assignment references this
-- skill by id, a foreign key will refuse this DELETE — that is the correct outcome and
-- the reason to run the rollback early rather than late.

BEGIN;

DELETE FROM skills WHERE slug = 'agent-wallet';

COMMIT;

-- VERIFY after running:
--   SELECT count(*) FROM skills s WHERE s.slug = 'agent-wallet';
--     -- 0
