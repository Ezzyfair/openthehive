-- Migration: skill_masteries table
-- For: V4 §2.10 Progressive Skill Unlocking
-- Date: April 26, 2026
-- Run in: Supabase SQL editor (paste, run, verify)
--
-- This table tracks every (bee, skill) mastery state. Records exist only for skills
-- the bee has begun engaging with — locked-by-default skills do not need a row until
-- they're unlocked into the bee's path.
--
-- The status field uses CHECK to enforce valid transitions. Transitions are managed
-- by application logic, not triggers, so application code is the source of truth.
--
-- Indexes: by agent (for "show me my path"), by status (for Elder dashboards), by skill
-- (for "how many bees have mastered this skill" analytics).

CREATE TABLE IF NOT EXISTS skill_masteries (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          UUID         NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  skill_id          UUID         NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  status            TEXT         NOT NULL CHECK (status IN ('locked', 'unlocked', 'in_progress', 'mastered')),
  unlocked_at       TIMESTAMPTZ,
  in_progress_at    TIMESTAMPTZ,
  mastered_at       TIMESTAMPTZ,
  verified_by       UUID         REFERENCES agents(id),
  honeycomb_url     TEXT,
  outcome_summary   TEXT,
  pollen_awarded    INTEGER      DEFAULT 0,
  created_at        TIMESTAMPTZ  DEFAULT now(),
  updated_at        TIMESTAMPTZ  DEFAULT now(),
  UNIQUE (agent_id, skill_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_skill_masteries_agent
  ON skill_masteries(agent_id);

CREATE INDEX IF NOT EXISTS idx_skill_masteries_status
  ON skill_masteries(status);

CREATE INDEX IF NOT EXISTS idx_skill_masteries_skill
  ON skill_masteries(skill_id);

CREATE INDEX IF NOT EXISTS idx_skill_masteries_agent_status
  ON skill_masteries(agent_id, status);

-- Helper: weekly unlock counter for cadence cap enforcement.
-- Returns count of skills moved into 'unlocked' status for a given agent
-- since the given timestamp. Used by app logic to enforce 1-skill-per-week.
CREATE OR REPLACE FUNCTION skills_unlocked_since(p_agent_id UUID, p_since TIMESTAMPTZ)
  RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM skill_masteries
  WHERE agent_id = p_agent_id
    AND unlocked_at IS NOT NULL
    AND unlocked_at >= p_since;
$$ LANGUAGE SQL STABLE;

-- Helper: mastered-skills count for an agent.
CREATE OR REPLACE FUNCTION skills_mastered_count(p_agent_id UUID)
  RETURNS INTEGER AS $$
  SELECT COUNT(*)::INTEGER
  FROM skill_masteries
  WHERE agent_id = p_agent_id
    AND status = 'mastered';
$$ LANGUAGE SQL STABLE;

-- updated_at trigger
CREATE OR REPLACE FUNCTION set_skill_masteries_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.updated_at = now();
    RETURN NEW;
  END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_skill_masteries_updated_at ON skill_masteries;
CREATE TRIGGER trg_skill_masteries_updated_at
  BEFORE UPDATE ON skill_masteries
  FOR EACH ROW
  EXECUTE FUNCTION set_skill_masteries_updated_at();

-- Verification queries (run after migration to confirm schema):
--
--   SELECT table_name, column_name, data_type
--   FROM information_schema.columns
--   WHERE table_name = 'skill_masteries'
--   ORDER BY ordinal_position;
--
--   SELECT indexname FROM pg_indexes WHERE tablename = 'skill_masteries';
