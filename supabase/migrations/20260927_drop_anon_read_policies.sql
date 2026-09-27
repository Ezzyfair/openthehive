-- Migration: drop the anon SELECT policies on honeycombs and messages
-- For: HUMAN-WINDOW-001 commit 5, the last of six. Plan sha 607ffb05.
-- Ticket: HUMAN-WINDOW-001
-- Date: September 27, 2026
-- Run in: Supabase SQL editor, BY HAND, after Nikita's PASS. NOT RUN.
--         No deploy runs this file. Nothing in the repo executes it.
-- Rollback: 20260927_drop_anon_read_policies_rollback.sql (sibling, same directory)
--
-- MONEY-PATH POSTURE. This changes who may READ every chamber and every message in the
-- colony. It is the only commit of the six that touches the database.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- DEPLOY ORDER — THIS RUNS LAST, AND COMMITS 1-4 ARE ALREADY LIVE AND PROVEN
-- ─────────────────────────────────────────────────────────────────────────────
-- Reversed from the usual, and stated because getting it backwards blanks the site:
--   commit 1  PR #6  main 4723b8d   homepage approved-only filter        LIVE
--   commit 2  PR #7  main cd5905c   member chamber + colony routes       LIVE
--   commit 3  PR #8  main 8ff2811   public showcase route, 24h window    LIVE, proven
--   commit 4  PR #9  main 2961851   every human view reads a server route LIVE
--   commit 5  THIS FILE                                                  <- now
-- Every reader was switched FIRST. After commit 4 there is no client-side reader of
-- honeycombs or messages left anywhere in app/, components/ or lib/ — verified by the
-- structural suite in NIK-HUMAN-WINDOW-001d and by production curls on 2961851. So
-- dropping these policies removes access nothing is using.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- CAPTURED LIVE BY FRANCIS, September 27, 2026 (SQL editor, pg_policies) — VERBATIM
-- ─────────────────────────────────────────────────────────────────────────────
--   honeycombs | "Public can view active honeycombs" | PERMISSIVE | {public} | SELECT | USING ((status)::text = 'active'::text)
--   honeycombs | "public_read_honeycombs"            | PERMISSIVE | {public} | SELECT | USING ((status)::text = 'active'::text)
--   messages   | "anon_read_approved_hive_messages"  | PERMISSIVE | {public} | SELECT | USING (((moderation_status)::text = 'approved'::text) AND (honeycomb_id IN ( SELECT hive_honeycomb_ids() AS hive_honeycomb_ids)))
--
--   No other policies exist on either table. RLS is ON for both (relrowsecurity true).
--   14 active hive rooms, 3 active personal chambers.
--
-- THE FINDING THIS CAPTURE MAKES PLAIN. Both honeycombs policies say only
-- status = 'active'. They do NOT filter on type, so they admit PERSONAL CHAMBERS to the
-- anon key — all 3 of them, today, to anyone with the key that ships in the browser
-- bundle. A chamber's title, description, creator_id and message_count have therefore
-- been publicly readable. The messages policy is narrower (approved, and only rooms
-- returned by hive_honeycomb_ids()), so chamber MESSAGE BODIES were not exposed by it —
-- but the chamber rows themselves were. This migration is what closes that, and it is a
-- stronger reason to run it than the tidiness of removing a now-unused lane.
--
-- {public} INCLUDES authenticated, NOT ONLY anon. Dropping these also ends read access
-- for a signed-in member's browser JWT. That is intended and safe: after commit 4 every
-- member read goes through /api/member/* with the service role, and zero anon-key clients
-- remain in components/ (asserted). Worth saying because "anon policies" undersells what
-- {public} covers.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS FILE DELIBERATELY DOES NOT TOUCH
-- ─────────────────────────────────────────────────────────────────────────────
--   hive_honeycomb_ids()  — the rollback's messages policy depends on it. Dropping or
--                           altering it would make the rollback unrunnable, which is the
--                           one thing a rollback must never be.
--   grants                — REVOKE/GRANT are a different axis from RLS and are not in
--                           scope. RLS with zero policies already denies every
--                           non-BYPASSRLS role.
--   realtime              — commit 4 removed all four channels from the code; the
--                           publication is not this file's business.
--   RLS itself            — never disabled, never forced. See guard 1.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- (a) PRE-RUN BASELINE — run this BEFORE the migration and keep the output
-- ─────────────────────────────────────────────────────────────────────────────
-- The SQL editor shows only the LAST result, so each block below ends with the one
-- SELECT whose output matters. Copy the block whole.
--
--   BEGIN;
--   SET LOCAL ROLE anon;
--   SELECT 'before' AS phase,
--          (SELECT count(*) FROM honeycombs) AS honeycombs_visible_to_anon,
--          (SELECT count(*) FROM messages)   AS messages_visible_to_anon;
--   ROLLBACK;
--
-- EXPECT both counts > 0 — that is the access this migration removes. If either is
-- already 0, STOP: something has changed since the capture and the drift guard below
-- will refuse the run anyway.
-- SET LOCAL ROLE inside a transaction that ROLLBACKs is used on purpose: the role
-- reverts even if the block errors, so no session is left as anon.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- (b) POST-RUN PROOF — run this AFTER, and keep the output next to (a)
-- ─────────────────────────────────────────────────────────────────────────────
--   BEGIN;
--   SET LOCAL ROLE anon;
--   SELECT 'after' AS phase,
--          (SELECT count(*) FROM pg_policies
--             WHERE tablename IN ('honeycombs','messages')) AS policies_remaining,
--          (SELECT count(*) FROM honeycombs) AS honeycombs_visible_to_anon,
--          (SELECT count(*) FROM messages)   AS messages_visible_to_anon;
--   ROLLBACK;
--
-- EXPECT policies_remaining 0, and BOTH anon counts 0.
-- pg_policies is read as anon here deliberately: it is a system view and stays readable,
-- so one block proves both facts at once.
--
-- And confirm RLS is still ON and still unforced (it should be untouched):
--   SELECT relname, relrowsecurity, relforcerowsecurity
--     FROM pg_class WHERE relname IN ('honeycombs','messages');
--   -- EXPECT relrowsecurity t, relforcerowsecurity f, for both.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- (c) CURL PROOF — run after (b). Every one of these must still pass.
-- ─────────────────────────────────────────────────────────────────────────────
-- The apex 307s to www, so -L is mandatory.
--
--   # the public showcase lane still serves messages AND the room title
--   curl -sL https://www.openthehive.ai/api/public/showcase/a6b07aa8-53bc-474b-8078-e30ee73c8ecd \
--     | head -c 400; echo
--   # EXPECT a JSON body containing "title", "window_hours":24 and a "messages" array.
--   # If "messages" is [] check the room is not simply quiet — compare against the same
--   # call taken before the migration.
--
--   curl -sL https://www.openthehive.ai/api/public/showcase/bfaca385-cebc-4f9e-8990-3d2a416f7715 \
--     | head -c 200; echo
--   # EXPECT the Welcome room, same shape.
--
--   # the member lane still refuses an unauthenticated caller with the same bytes
--   curl -sL -o /dev/null -w '%{http_code}\n' https://www.openthehive.ai/api/member/chamber
--   # EXPECT 401
--
--   # the pages still render
--   for p in / /honeycombs; do
--     curl -sL -o /dev/null -w "%{http_code}  $p\n" "https://www.openthehive.ai$p"; done
--   # EXPECT 200 200
--
-- IF THE SHOWCASE ROUTE GOES EMPTY OR A PAGE 500s, run the rollback. It restores all
-- three policies exactly and the site returns to its pre-migration behaviour.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- GUARD 1 · RLS must be ON for both tables before any policy is dropped
-- ─────────────────────────────────────────────────────────────────────────────
-- This is the guard that matters most. With RLS ON, a table with zero policies denies
-- every non-BYPASSRLS role — dropping policies CLOSES it. With RLS OFF, policies are
-- inert and the table is already wide open to anyone holding the key; dropping them
-- would change nothing and would leave this file looking like it had secured something.
-- So: if RLS is off, the honest answer is to abort and say so, not to proceed.
DO $$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(c.relname || ' (relrowsecurity=' || c.relrowsecurity || ')', ', ')
    INTO v_bad
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relname IN ('honeycombs', 'messages')
     AND c.relrowsecurity IS NOT TRUE;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'ABORT: row level security is not enabled on: %. Dropping policies would OPEN these tables, not close them. Enable RLS first, then re-run.',
      v_bad;
  END IF;

  -- Both tables must also still EXIST and be visible; a missing table is a different
  -- surprise and deserves its own message rather than a confusing count mismatch.
  IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname IN ('honeycombs','messages')) <> 2 THEN
    RAISE EXCEPTION 'ABORT: expected both public.honeycombs and public.messages to exist.';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- GUARD 2 · drift check — each policy must exist with exactly the captured qual
-- ─────────────────────────────────────────────────────────────────────────────
-- If someone has edited, narrowed, widened or replaced a policy since the September 27
-- capture, this migration is operating on something it was not reviewed against and must
-- refuse. The whole transaction aborts and nothing is dropped.
--
-- The comparison normalises RUNS OF WHITESPACE to single spaces and trims. That is not a
-- loosening: pg_get_expr chooses its own line breaks and indentation when it renders a
-- subquery, and a newline is not a semantic difference. A changed column, a changed
-- function, a removed AND, an added OR — every drift that matters still fails the check,
-- because normalising whitespace cannot make two different expressions equal. The exact
-- value found is included in the error so the difference is visible immediately.
DO $$
DECLARE
  r RECORD;
  v_found TEXT;
  v_norm  TEXT;
  v_want  TEXT;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('honeycombs', 'Public can view active honeycombs',
       '((status)::text = ''active''::text)'),
      ('honeycombs', 'public_read_honeycombs',
       '((status)::text = ''active''::text)'),
      ('messages',   'anon_read_approved_hive_messages',
       '(((moderation_status)::text = ''approved''::text) AND (honeycomb_id IN ( SELECT hive_honeycomb_ids() AS hive_honeycomb_ids)))')
    ) AS t(tbl, pol, qual)
  LOOP
    SELECT pg_get_expr(p.polqual, p.polrelid)
      INTO v_found
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = r.tbl AND p.polname = r.pol;

    IF v_found IS NULL THEN
      RAISE EXCEPTION
        'ABORT: policy "%" on public.% was not found. The capture this migration was reviewed against is stale; re-capture pg_policies and have the change reviewed before re-running.',
        r.pol, r.tbl;
    END IF;

    v_norm := btrim(regexp_replace(v_found, '\s+', ' ', 'g'));
    v_want := btrim(regexp_replace(r.qual,  '\s+', ' ', 'g'));

    IF v_norm <> v_want THEN
      RAISE EXCEPTION
        'ABORT: policy "%" on public.% has drifted. Expected USING %  but found USING %. Nothing was dropped.',
        r.pol, r.tbl, v_want, v_norm;
    END IF;
  END LOOP;

  -- And nothing NEW may have appeared: the capture says these three are the only
  -- policies on either table. A fourth one is something this migration has not been
  -- reviewed against, and dropping three of four could leave a half-open door.
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'public' AND tablename IN ('honeycombs','messages')) <> 3 THEN
    RAISE EXCEPTION
      'ABORT: expected exactly 3 policies across public.honeycombs and public.messages, found %. Re-capture and re-review.',
      (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public' AND tablename IN ('honeycombs','messages'));
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- THE DROPS · three statements, nothing else
-- ─────────────────────────────────────────────────────────────────────────────
-- No IF EXISTS: guard 2 has already proven all three are present with the reviewed
-- definitions, so a missing one here would be a race worth failing on rather than
-- skipping past quietly.
DROP POLICY "Public can view active honeycombs" ON public.honeycombs;
DROP POLICY "public_read_honeycombs" ON public.honeycombs;
DROP POLICY "anon_read_approved_hive_messages" ON public.messages;

COMMIT;

-- Now run (b), then (c). Keep both outputs beside the (a) baseline — the three together
-- are the record that this migration did what it says.
