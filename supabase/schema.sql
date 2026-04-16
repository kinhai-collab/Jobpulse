-- JobPulse Supabase schema
-- Run this in the Supabase SQL editor after creating a new project.
-- Assumes Supabase Auth is enabled (it is by default).

-- =============================================================================
-- JOBS — cached job listings from the daily scan
-- This table is shared across all users. Populated by the scan job.
-- Not user-scoped, so no RLS needed for read — anyone logged in can see the cache.
-- =============================================================================
create table if not exists public.jobs (
  id              text primary key,              -- stable id: "{company_id}:{source_id}"
  company_id      text not null,                 -- matches companies.json id, e.g. "anthropic"
  company_name    text not null,
  title           text not null,
  location        text,
  url             text not null,
  salary_min      integer,                       -- USD, annualized. null if not disclosed
  salary_max      integer,
  posted_at       timestamptz,                   -- when the ATS says it was posted (best effort)
  first_seen_at   timestamptz not null default now(),  -- when OUR scan first saw it
  last_seen_at    timestamptz not null default now(),  -- updated every scan that still finds it
  is_active       boolean not null default true, -- set false when a scan stops finding it
  source          text not null,                 -- "greenhouse" | "lever" | "ashby" | "fallback"
  raw             jsonb                           -- original ATS payload, for debugging
);

create index if not exists jobs_company_idx on public.jobs (company_id);
create index if not exists jobs_first_seen_idx on public.jobs (first_seen_at desc);
create index if not exists jobs_active_idx on public.jobs (is_active) where is_active = true;
create index if not exists jobs_title_trgm_idx on public.jobs using gin (title gin_trgm_ops);

-- Enable trigram extension for fuzzy title search (so "pm" matches "Product Manager")
create extension if not exists pg_trgm;

-- Anyone authenticated can read the cache, no one can write via API
alter table public.jobs enable row level security;

drop policy if exists "jobs_read_authenticated" on public.jobs;
create policy "jobs_read_authenticated"
  on public.jobs for select
  using (auth.role() = 'authenticated');

-- Writes only happen from the serverless scan function, which uses the service role key
-- (service role bypasses RLS by default)


-- =============================================================================
-- APPLICATIONS — per-user log of jobs the user has applied to
-- =============================================================================
create table if not exists public.applications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  job_id          text not null references public.jobs(id) on delete cascade,
  applied_at      timestamptz not null default now(),
  resume_version  text,                           -- free text: "Resume_v3.pdf", "AI PM focused", etc.
  notes           text,
  unique (user_id, job_id)                        -- one application per user per job
);

create index if not exists applications_user_idx on public.applications (user_id, applied_at desc);

alter table public.applications enable row level security;

drop policy if exists "applications_own_rows" on public.applications;
create policy "applications_own_rows"
  on public.applications
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- =============================================================================
-- USER_PREFS — per-user filters and settings
-- =============================================================================
create table if not exists public.user_prefs (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  title_keywords  text,                           -- "product manager, program manager"
  min_salary      integer,
  excluded_companies text[],                      -- list of company_ids the user doesn't want to see
  resume_versions text[],                         -- list of resume names the user has
  last_seen_at    timestamptz,                    -- used to compute "new since last visit"
  updated_at      timestamptz not null default now()
);

alter table public.user_prefs enable row level security;

drop policy if exists "user_prefs_own_rows" on public.user_prefs;
create policy "user_prefs_own_rows"
  on public.user_prefs
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- =============================================================================
-- SCAN_RUNS — audit log of daily scans, for debugging coverage issues
-- =============================================================================
create table if not exists public.scan_runs (
  id              uuid primary key default gen_random_uuid(),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  jobs_found      integer,
  jobs_new        integer,
  companies_scanned integer,
  companies_failed integer,
  errors          jsonb,                          -- {company_id: error_message}
  source          text                            -- "cron" | "manual"
);

create index if not exists scan_runs_started_idx on public.scan_runs (started_at desc);

alter table public.scan_runs enable row level security;

-- Scan runs are readable by any authenticated user (for transparency on the dashboard)
drop policy if exists "scan_runs_read_authenticated" on public.scan_runs;
create policy "scan_runs_read_authenticated"
  on public.scan_runs for select
  using (auth.role() = 'authenticated');


-- =============================================================================
-- Helper view — "fresh jobs for this user" used by the dashboard
-- Returns active jobs with an applied flag for the current user
-- =============================================================================
create or replace view public.jobs_with_my_status as
select
  j.*,
  a.id is not null     as has_applied,
  a.applied_at          as applied_at,
  a.resume_version      as resume_version
from public.jobs j
left join public.applications a
  on a.job_id = j.id and a.user_id = auth.uid()
where j.is_active = true;

-- Views inherit RLS from their base tables (jobs + applications), so no extra policy needed.
