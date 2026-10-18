-- supabase/tests/skills_stub.sql
-- ----------------------------------------------------------------------------
-- THE HIVE — LOCAL SCRATCH stub of the `skills` table, for exercising a skill-row
-- migration. Ticket NIK-SKILL-WALLET-001.
--
-- NEVER RUN AGAINST SUPABASE. It builds a throwaway table in a local database
-- (psql -d railtest) whose column list and types are transcribed from
-- ~/Downloads/SKILLS-SHAPE-2026-10-18.txt (the Oct 18 readout, sha256
-- e4d270905b3b75ed67c11aa4d2ac7640ca621844bb320934efaf4fbdc05c390c).
--
-- EIGHTEEN COLUMNS, NOT SEVENTEEN. The ticket says 17; the readout lists 18, and all
-- 18 are below. Counted twice: id, slug, name, description, pillar, difficulty,
-- mastery_pollen_reward, tags, content_markdown, first_flight, mandatory, premium,
-- featured, sort_order, status, quality_score, created_at, updated_at.
--
-- WHAT THIS STUB DOES NOT KNOW, and therefore what the scratch run cannot settle:
-- the readout lists column names and types only. It carries no CHECK constraints, no
-- NOT NULLs, no UNIQUE indexes and no defaults. So this stub declares only the
-- primary key, and in particular it does NOT put a UNIQUE index on slug or on
-- sort_order. A scratch run against it therefore proves that the migration's SQL is
-- valid and that its values land in the right columns with the right types — it does
-- NOT prove the INSERT will be accepted by production, where a UNIQUE index on
-- sort_order would reject it (see the forward migration's note on sort_order 11).
-- Inventing constraints here would make the scratch run look like it proved more than
-- it does.
-- ----------------------------------------------------------------------------

DROP TABLE IF EXISTS skills CASCADE;

CREATE TABLE skills (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                  text,
  name                  text,
  description           text,
  pillar                text,
  difficulty            text,
  mastery_pollen_reward integer,
  tags                  text[],
  content_markdown      text,
  first_flight          boolean,
  mandatory             boolean,
  premium               boolean,
  featured              boolean,
  sort_order            integer,
  status                text,
  quality_score         numeric,
  created_at            timestamptz,
  updated_at            timestamptz
);

-- One pre-existing row, so the scratch run is not inserting into an empty table and
-- the guard has something to scan past. It is the PAIRED skill from the readout,
-- including its sort_order 11 — which is what makes the collision visible here.
INSERT INTO skills (slug, name, description, pillar, difficulty,
                    mastery_pollen_reward, tags, content_markdown,
                    first_flight, mandatory, premium, featured, sort_order,
                    status, quality_score, created_at, updated_at)
VALUES ('digital-wallet-mastery',
        'Getting Paid: Stripe Connect for Bees',
        'Set up your Stripe Connect payout account so earnings land in your bank — identity check, security, first payout.',
        'SHIP', 'Beginner', 100,
        ARRAY['stripe-connect','payouts','payments']::text[],
        '# SKILL: Getting Paid (stub body, not the real one)',
        false, false, false, false, 11, 'published', NULL, now(), now());

SELECT count(*) AS stub_rows,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'skills') AS column_count
  FROM skills;
