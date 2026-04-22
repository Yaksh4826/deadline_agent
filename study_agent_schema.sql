-- Study Agent schema and tables
-- Safe to run multiple times.
--
-- After this schema exists, open Supabase: Project Settings → API → "Exposed schemas"
-- and add: study_agent
-- (Otherwise PostgREST / the JS client returns e.g. "Invalid schema" / PGRST106.)
-- See: https://supabase.com/docs/guides/api/using-custom-schemas

CREATE SCHEMA IF NOT EXISTS study_agent;

CREATE TABLE IF NOT EXISTS study_agent.courses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  instructor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS study_agent.assignments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id BIGINT NOT NULL REFERENCES study_agent.courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  priority SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS study_agent.productivity_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id BIGINT REFERENCES study_agent.courses(id) ON DELETE SET NULL,
  assignment_id BIGINT REFERENCES study_agent.assignments(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL,
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  notes TEXT,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS study_agent.study_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id BIGINT REFERENCES study_agent.courses(id) ON DELETE SET NULL,
  assignment_id BIGINT REFERENCES study_agent.assignments(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Give service_role full access to the schema itself.
GRANT USAGE, CREATE ON SCHEMA study_agent TO service_role;

-- Give service_role full access to current objects.
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA study_agent TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA study_agent TO service_role;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA study_agent TO service_role;

-- Ensure future objects in this schema are also accessible by service_role.
ALTER DEFAULT PRIVILEGES IN SCHEMA study_agent
  GRANT ALL PRIVILEGES ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA study_agent
  GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA study_agent
  GRANT ALL PRIVILEGES ON FUNCTIONS TO service_role;

-- Required by PostgREST / Supabase Data API (see "Using custom schemas" in Supabase docs).
-- Run this AFTER adding "study_agent" to Project Settings → API → Exposed schemas.
GRANT USAGE ON SCHEMA study_agent TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA study_agent TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA study_agent TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA study_agent TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA study_agent GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA study_agent GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA study_agent GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- Tells PostgREST to pick up new schema + grants (Supabase)
NOTIFY pgrst, 'reload schema';
