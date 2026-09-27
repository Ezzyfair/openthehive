-- Rollback: restore the anon SELECT policies on honeycombs and messages
-- Undoes: 20260927_drop_anon_read_policies.sql (sibling, same directory)
-- Ticket: HUMAN-WINDOW-001 commit 5
-- Date: September 27, 2026
-- Run in: Supabase SQL editor, BY HAND.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK FIRST, THEN REVERT THE CODE. Order matters and it is the reverse of the
-- forward direction.
-- ─────────────────────────────────────────────────────────────────────────────
-- Run this file, confirm the policies are back, and only then revert any of commits 1-4
-- if you mean to. Doing it the other way round — reverting the code while the policies
-- are still dropped — puts the old anon-key readers back in the browser with nothing to
-- read, and the site renders empty rooms everywhere for as long as that lasts.
--
-- WHEN THIS IS ACTUALLY NEEDED. Almost never, and that is worth saying plainly. After
-- commit 4 nothing in app/, components/ or lib/ reads honeycombs or messages with the
-- anon key, so restoring these policies restores access that no code uses. The one
-- scenario that calls for it is the forward migration having broken something nobody
-- predicted — a public page going empty, a 500 on the showcase route — where returning
-- the database to its exact prior state is the fastest way to stop the bleeding while the
-- real cause is found.
--
-- THIS RESTORES A KNOWN EXPOSURE, ON PURPOSE. Both honeycombs policies filter only on
-- status = 'active' and not on type, so recreating them makes all 3 active PERSONAL
-- chambers readable by the anon key again — their title, description, creator_id and
-- message_count. That is exactly the state of the world before the forward migration,
-- which is what a rollback is for; it is not an improvement and should not be left in
-- place longer than the incident lasts.
--
-- DEPENDENCY. The messages policy calls hive_honeycomb_ids(). The forward migration
-- deliberately does not touch that function, so it is still here. If it has been dropped
-- by something else, the third CREATE POLICY below fails and the whole transaction
-- rolls back — restoring nothing rather than restoring two of three. That is the correct
-- failure: a half-restored policy set is worse than none.
--
-- VERIFY AFTER RUNNING (the editor shows only the last result, so this is one SELECT):
--   SELECT tablename, policyname, permissive, roles, cmd, qual
--     FROM pg_policies
--    WHERE schemaname = 'public' AND tablename IN ('honeycombs','messages')
--    ORDER BY tablename, policyname;
--
--   EXPECT exactly these three rows, matching the September 27 capture byte for byte:
--     honeycombs | "Public can view active honeycombs" | PERMISSIVE | {public} | SELECT | USING ((status)::text = 'active'::text)
--     honeycombs | "public_read_honeycombs"            | PERMISSIVE | {public} | SELECT | USING ((status)::text = 'active'::text)
--     messages   | "anon_read_approved_hive_messages"  | PERMISSIVE | {public} | SELECT | USING (((moderation_status)::text = 'approved'::text) AND (honeycomb_id IN ( SELECT hive_honeycomb_ids() AS hive_honeycomb_ids)))
--
-- And that anon can read again:
--   BEGIN;
--   SET LOCAL ROLE anon;
--   SELECT (SELECT count(*) FROM honeycombs) AS honeycombs_visible_to_anon,
--          (SELECT count(*) FROM messages)   AS messages_visible_to_anon;
--   ROLLBACK;
--   -- EXPECT both > 0, matching the pre-run baseline recorded in the forward file's (a).

BEGIN;

-- honeycombs · two policies, identical quals. Both are recreated: the capture shows two
-- and the forward migration dropped two, so restoring one would silently change the
-- policy set rather than restore it. Which of the pair is redundant is a question for a
-- separate ticket, not for a rollback.
CREATE POLICY "Public can view active honeycombs"
  ON public.honeycombs
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((status)::text = 'active'::text);

CREATE POLICY "public_read_honeycombs"
  ON public.honeycombs
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((status)::text = 'active'::text);

-- messages · approved only, and only rooms hive_honeycomb_ids() returns.
CREATE POLICY "anon_read_approved_hive_messages"
  ON public.messages
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((moderation_status)::text = 'approved'::text) AND (honeycomb_id IN ( SELECT hive_honeycomb_ids() AS hive_honeycomb_ids)));

COMMIT;

-- Nothing else to undo. The forward migration altered no table, changed no grant, touched
-- neither RLS nor hive_honeycomb_ids(), and created nothing — so restoring these three
-- policies restores the database exactly.
