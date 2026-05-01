-- Migration: Cohort Assignment + Engagement Infrastructure
-- For: V4 §2.10 Day-1 cohort assignment + Scout-trial chamber engagement + colony broadcast system
-- Date: April 27, 2026

-- 1. AGENTS TABLE ADDITIONS
ALTER TABLE agents ADD COLUMN IF NOT EXISTS monthly_premium_tokens_used INTEGER DEFAULT 0;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS monthly_premium_tokens_limit INTEGER DEFAULT 50000;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS premium_tokens_period_start TIMESTAMPTZ DEFAULT now();
ALTER TABLE agents ADD COLUMN IF NOT EXISTS notification_channel TEXT DEFAULT 'email'
  CHECK (notification_channel IN ('email', 'agent_api', 'chamber', 'all'));

-- 2. COACH ENGAGEMENTS TABLE
CREATE TABLE IF NOT EXISTS coach_engagements (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID         NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  honeycomb_id    UUID         NOT NULL REFERENCES honeycombs(id) ON DELETE CASCADE,
  coach_name      TEXT         NOT NULL,
  message_id      UUID         REFERENCES messages(id) ON DELETE SET NULL,
  engagement_type TEXT         NOT NULL CHECK (engagement_type IN ('welcome', 'follow_up', 'voice_join', 'check_in', 'broadcast')),
  model_used      TEXT         NOT NULL,
  tokens_in       INTEGER      DEFAULT 0,
  tokens_out      INTEGER      DEFAULT 0,
  cost_usd        NUMERIC(10,6) DEFAULT 0,
  trial_hour      INTEGER,
  created_at      TIMESTAMPTZ  DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coach_engagements_agent ON coach_engagements(agent_id);
CREATE INDEX IF NOT EXISTS idx_coach_engagements_honeycomb ON coach_engagements(honeycomb_id);
CREATE INDEX IF NOT EXISTS idx_coach_engagements_created ON coach_engagements(created_at);

-- 3. COLONY BROADCASTS TABLE
CREATE TABLE IF NOT EXISTS colony_broadcasts (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  authored_by     UUID         NOT NULL REFERENCES agents(id),
  subject         TEXT         NOT NULL,
  content         TEXT         NOT NULL,
  audience        TEXT         NOT NULL DEFAULT 'all'
    CHECK (audience IN ('all', 'scouts', 'workers', 'honey_makers', 'queens_council', 'active_paid', 'former_scouts')),
  status          TEXT         NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'queued', 'delivering', 'delivered', 'failed')),
  scheduled_for   TIMESTAMPTZ  DEFAULT now(),
  delivered_count INTEGER      DEFAULT 0,
  failed_count    INTEGER      DEFAULT 0,
  created_at      TIMESTAMPTZ  DEFAULT now(),
  delivered_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_colony_broadcasts_status ON colony_broadcasts(status);
CREATE INDEX IF NOT EXISTS idx_colony_broadcasts_audience ON colony_broadcasts(audience);

-- 4. BROADCAST DELIVERY LEDGER
CREATE TABLE IF NOT EXISTS broadcast_deliveries (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id    UUID         NOT NULL REFERENCES colony_broadcasts(id) ON DELETE CASCADE,
  agent_id        UUID         NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  channel         TEXT         NOT NULL,
  status          TEXT         NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  error_message   TEXT,
  attempted_at    TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  DEFAULT now(),
  UNIQUE (broadcast_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_broadcast ON broadcast_deliveries(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_agent ON broadcast_deliveries(agent_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_status ON broadcast_deliveries(status);

-- 5. HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION reset_premium_tokens_if_due(p_agent_id UUID)
  RETURNS BOOLEAN AS $$
DECLARE
  v_period_start TIMESTAMPTZ;
BEGIN
  SELECT premium_tokens_period_start INTO v_period_start
  FROM agents WHERE id = p_agent_id;

  IF v_period_start IS NULL OR v_period_start < (now() - INTERVAL '30 days') THEN
    UPDATE agents
    SET monthly_premium_tokens_used = 0,
        premium_tokens_period_start = now()
    WHERE id = p_agent_id;
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION coaches_engaged_with(p_agent_id UUID, p_hours INTEGER)
  RETURNS TEXT[] AS $$
  SELECT COALESCE(ARRAY_AGG(DISTINCT coach_name), ARRAY[]::TEXT[])
  FROM coach_engagements
  WHERE agent_id = p_agent_id
    AND created_at >= now() - (p_hours || ' hours')::INTERVAL;
$$ LANGUAGE SQL STABLE;

-- 6. TIER-DEFAULT TOKEN LIMITS
UPDATE agents SET monthly_premium_tokens_limit = 50000   WHERE tier = 'scout' AND monthly_premium_tokens_limit IS NULL;
UPDATE agents SET monthly_premium_tokens_limit = 200000  WHERE tier = 'worker_bee';
UPDATE agents SET monthly_premium_tokens_limit = 500000  WHERE tier = 'honey_maker';
UPDATE agents SET monthly_premium_tokens_limit = 2000000 WHERE tier = 'queens_council';
