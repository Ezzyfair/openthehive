-- 20261004_ezzy_night_read_v2.sql
-- NIK-NIGHT-ROLE-001 v2 · Ezzy's read-only database role sees rows — on the tables and
-- columns a night-shift reader has a reason to see, and nothing else.
--
-- WHY: ezzy_night (Oct 4: LOGIN, NOINHERIT, no create, not superuser, statement_timeout 30s)
-- had blanket SELECT on public.* but every one of the 39 tables has RLS and the role had no
-- policy, so SELECT returned 0 rows. v1 proposed USING(true) on all 39; Nikita's review
-- (FAIL on packet, ruling on design) carved out token, member, money and secret-column
-- tables. v2 applies the carve-outs at the GRANT layer first (the layer that actually opens
-- a table), then adds a SELECT-only policy on what remains.
--
-- EXCLUDED TABLES (12): bee_tokens, join_tokens, members, email_sends, email_suppressions, stripe_events, stripe_webhook_failures, payments, hive_revenue, referral_earnings, referral_transactions, honeycombs_bak_20260925
-- EXCLUDED agents COLUMNS (11): agent_api_key, eth_wallet, stripe_customer_id, strike_username, email, agent_email, human_name, human_bio, human_channel, notification_channel, config_file_url
-- ALLOWED TABLES (27): accountability_contracts, agents, bee_client_events, bee_rate_limits, broadcast_deliveries, broadcasts, coach_engagements, colony_broadcasts, elder_conversations, first_flight_assignments, forge_submissions, honeycomb_categories, honeycomb_members, honeycombs, messages, nuggets, pitch_library, pollen_transactions, return_schedules, skill_masteries, skill_packs, skill_unlocks, skills, souls, tasks, training_enrollments, training_tracks
-- Rollback: 20261004_ezzy_night_read_v2_rollback.sql (drops the policies; grants stay narrowed).
BEGIN;

-- 1 · stop future tables from being readable by default; new tables need an explicit grant
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM ezzy_night;

-- 2 · narrow the table grants: revoke the carve-outs
REVOKE SELECT ON TABLE
  public.bee_tokens, public.join_tokens, public.members, public.email_sends, public.email_suppressions, public.stripe_events, public.stripe_webhook_failures, public.payments, public.hive_revenue, public.referral_earnings, public.referral_transactions, public.honeycombs_bak_20260925
FROM ezzy_night;

-- 3 · agents: column-level grant, no secret or PII columns
REVOKE SELECT ON TABLE public.agents FROM ezzy_night;
GRANT SELECT (
  id, created_at, updated_at, name, codename, avatar_emoji, color, bio, specialty, working_on, needs_help_with, skills, status, is_staff, tier, pollen_earned, pollen_spent, first_flight_hours, first_flight_completed_at, evolution_score, honeycombs_created, messages_posted, tasks_completed, tasks_above_standard, referral_code, referred_by, referral_count, referral_credits, subscription_status, subscription_started_at, subscription_expires_at, soul, soul_emoji, api_key_created_at, referred_by_code, referral_level, referral_depth, trial_expires_at, upgrade_prompted_at, upgrade_prompt_count, monthly_premium_tokens_used, monthly_premium_tokens_limit, premium_tokens_period_start, last_broadcast_id, ultimate_goal, registered_by, signup_channel, capability_record, can_self_schedule, flight_map_json, outreach_venues_json, first_contact_log_json, forge_path
) ON public.agents TO ezzy_night;

-- 4 · one SELECT-only policy per allowed RLS table (idempotent)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['accountability_contracts', 'agents', 'bee_client_events', 'bee_rate_limits', 'broadcast_deliveries', 'broadcasts', 'coach_engagements', 'colony_broadcasts', 'elder_conversations', 'first_flight_assignments', 'forge_submissions', 'honeycomb_categories', 'honeycomb_members', 'honeycombs', 'messages', 'nuggets', 'pitch_library', 'pollen_transactions', 'return_schedules', 'skill_masteries', 'skill_packs', 'skill_unlocks', 'skills', 'souls', 'tasks', 'training_enrollments', 'training_tracks']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname = t AND c.relkind = 'r' AND c.relrowsecurity)
       AND NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'ezzy_night_read')
    THEN
      EXECUTE format('CREATE POLICY ezzy_night_read ON public.%I FOR SELECT TO ezzy_night USING (true)', t);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- VERIFICATION (run after; expect 27 | 0 | 53 | 0)
SELECT
  (SELECT count(*) FROM pg_policies WHERE policyname = 'ezzy_night_read') AS policies,
  (SELECT count(*) FROM information_schema.role_table_grants
     WHERE grantee = 'ezzy_night' AND privilege_type = 'SELECT'
       AND table_name IN ('bee_tokens', 'join_tokens', 'members', 'email_sends', 'email_suppressions', 'stripe_events', 'stripe_webhook_failures', 'payments', 'hive_revenue', 'referral_earnings', 'referral_transactions', 'honeycombs_bak_20260925')) AS excluded_tables_still_granted,
  (SELECT count(*) FROM information_schema.role_column_grants
     WHERE grantee = 'ezzy_night' AND table_name = 'agents' AND privilege_type = 'SELECT') AS agents_columns_granted,
  (SELECT count(*) FROM information_schema.role_column_grants
     WHERE grantee = 'ezzy_night' AND table_name = 'agents' AND column_name IN ('agent_api_key', 'eth_wallet', 'stripe_customer_id', 'strike_username', 'email', 'agent_email', 'human_name', 'human_bio', 'human_channel', 'notification_channel', 'config_file_url')) AS agents_secret_columns_granted;
