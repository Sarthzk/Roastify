-- Auth + persistence foundation for Roastify. Chat and public share pages build on this
-- schema later (see CLAUDE.md's "Auth & data" section) — visibility/slug are added now,
-- nullable and unused, so that follow-up work is additive rather than a rewrite.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- roasts
-- ---------------------------------------------------------------------------
-- user_id is nullable on purpose: an anonymous roast is still inserted (for analytics),
-- just not attributed to anyone or listed in anyone's history. The server derives
-- user_id itself from a verified JWT (api/_lib/auth.js) and writes it via the service
-- role key — never from client-sent input.
create table if not exists public.roasts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  type text not null check (type in ('github', 'linkedin', 'instagram', 'resume')),
  identifier text,
  persona text not null,
  severity text not null check (severity in ('mild', 'medium', 'destroy me')),
  model text not null,
  roast text not null,
  tips jsonb not null default '[]'::jsonb,
  -- Additive columns for the future public-share-page feature (not built yet — see
  -- CLAUDE.md's scope boundary). Nullable and unused today so that feature doesn't need
  -- a schema rewrite, only logic on top of these.
  visibility text check (visibility in ('private', 'unlisted', 'public')),
  slug text unique,
  created_at timestamptz not null default now()
);

create index if not exists roasts_user_id_idx on public.roasts (user_id);
create index if not exists roasts_created_at_idx on public.roasts (created_at desc);

alter table public.roasts enable row level security;

-- A user can read only their own roasts. auth.uid() is null for the anon key (no JWT, or
-- an invalid one), and `null = user_id` is never true in SQL even when user_id is also
-- null — so anonymous rows are unreadable by anyone through the anon key, by construction
-- rather than by a special-cased policy.
create policy "roasts: read own" on public.roasts
  for select
  using (auth.uid() = user_id);

create policy "roasts: delete own" on public.roasts
  for delete
  using (auth.uid() = user_id);

-- Deliberately no INSERT (or UPDATE) policy for anon/authenticated: every roast is
-- written server-side via the service role key (which bypasses RLS entirely), never
-- directly by a client against PostgREST. Leaving these unwritten is the secure default
-- — anon/authenticated get a default deny.

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------
-- For moderating shared content later (public share pages — not built yet). Schema only
-- for now: no application code reads or writes this table today.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  roast_id uuid not null references public.roasts (id) on delete cascade,
  reporter_user_id uuid references auth.users (id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index if not exists reports_roast_id_idx on public.reports (roast_id);

alter table public.reports enable row level security;

-- No policies yet — default deny for anon/authenticated (only the service role key can
-- read/write) until the report-submission and moderation features are actually built.
