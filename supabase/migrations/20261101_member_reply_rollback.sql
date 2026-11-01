-- 20261101_member_reply_rollback.sql — undoes 20261101_member_reply.sql.
--
-- Refuses while human replies exist: dropping member_id would leave rows with no author
-- and no way back. Deciding what happens to a human's words is a ruling, not a script.
--
-- SET NOT NULL below is correct only if the preflight answered is_nullable = 'NO'.
-- If it answered 'YES', delete that line before running.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM messages WHERE agent_id IS NULL) THEN
    RAISE EXCEPTION 'messages has rows with agent_id null; rollback refused';
  END IF;
END $$;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_one_author;
DROP INDEX IF EXISTS idx_messages_member_id;
ALTER TABLE messages DROP COLUMN IF EXISTS member_id;
ALTER TABLE messages ALTER COLUMN agent_id SET NOT NULL;

COMMIT;
