-- 20261004_ezzy_night_read_v2_rollback.sql
-- Drops every ezzy_night_read policy. The narrowed grants and the default-privilege revoke
-- are LEFT IN PLACE on purpose: less access is never a regression, and Nikita ruled the
-- role/grant undo out of scope. After this the role reads zero rows again (pre-v2 state).
BEGIN;
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'ezzy_night_read'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS ezzy_night_read ON public.%I', p.tablename);
  END LOOP;
END $$;
COMMIT;
SELECT count(*) AS ezzy_policies_left FROM pg_policies WHERE policyname = 'ezzy_night_read';  -- expect 0
