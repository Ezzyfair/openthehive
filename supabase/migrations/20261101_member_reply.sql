-- 20261101_member_reply.sql — MEMBER-001 item 5: a human's reply in their bee's chamber.
-- NOT RUN. Run by Francis in the Supabase SQL editor after Nikita's review.
-- Rollback: 20261101_member_reply_rollback.sql
--
-- PREFLIGHT, read-only. Record the answers in the packet before running this.
--   SELECT is_nullable FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='messages' AND column_name='agent_id';
--   SELECT count(*) FROM messages WHERE agent_id IS NULL;
--     Must be 0. /api/member/chamber and /api/bee/poll draw every agent_id-null row as
--     the human, so an existing null row would be mislabelled.
--   SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--    WHERE tgrelid='public.messages'::regclass AND NOT tgisinternal;
--     Any trigger that uses NEW.agent_id must be read: a human row now has it null.

BEGIN;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES members(id) ON DELETE SET NULL;

ALTER TABLE messages ALTER COLUMN agent_id DROP NOT NULL;

-- A row has one author. This is what makes "never as the bee" true at the table and
-- not only in the route. NOT VALID: it binds every new row and does not judge history.
-- ON DELETE SET NULL above can leave a human row with neither author, so the rule is
-- "never both", not "exactly one".
ALTER TABLE messages
  ADD CONSTRAINT messages_one_author CHECK (agent_id IS NULL OR member_id IS NULL) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_messages_member_id ON messages(member_id) WHERE member_id IS NOT NULL;

COMMIT;
