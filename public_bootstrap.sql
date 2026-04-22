-- Run this in Supabase SQL Editor when you want tables in the `public` schema
-- (PostgREST / Data API can always see `public` — no "Exposed schemas" step).
--
-- Then in web/web/.env.local set:
--   NEXT_PUBLIC_DB_SCHEMA=public
-- or remove NEXT_PUBLIC_DB_SCHEMA so the app default is public.
--
-- Safe to run multiple times (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS public.courses (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  instructor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.assignments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id BIGINT NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  due_date TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending',
  priority SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.productivity_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id BIGINT REFERENCES public.courses(id) ON DELETE SET NULL,
  assignment_id BIGINT REFERENCES public.assignments(id) ON DELETE SET NULL,
  activity_type TEXT NOT NULL,
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  notes TEXT,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.study_sessions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  course_id BIGINT REFERENCES public.courses(id) ON DELETE SET NULL,
  assignment_id BIGINT REFERENCES public.assignments(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

NOTIFY pgrst, 'reload schema';
