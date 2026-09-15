-- Gives chat access to the scraped profile data behind a roast, for github/instagram
-- only — see CLAUDE.md's "Chat" section for the full reasoning. Extends the existing
-- roasts table (20260912000000_roasts_and_reports.sql) rather than adding a join table:
-- profile_data has a strict 1:1 relationship with a roast (one optional scrape snapshot
-- per roast, not a many-side relationship), it's small (already capped to
-- MAX_INPUT_LENGTH — see api/roast.js), and it needs exactly the same ownership/RLS/
-- cascade-delete behavior the roasts row already has. A join table would need its own
-- RLS policies duplicating that same ownership check, and its own cascade-on-delete FK
-- back to roasts — which is just user_id's existing cascade again, one level removed, for
-- no real benefit.
--
-- GitHub and Instagram profiles are already public and low-PII, so storing them here is
-- fine. LinkedIn and resume come from an uploaded document — full name, employer,
-- sometimes phone/address — and the privacy page promises "uploaded files are never
-- stored. The PDF stays in your browser." That promise stays true: profile_data is only
-- ever written for github/instagram, enforced at the application layer
-- (api/_lib/persistRoast.js's STORABLE_PROFILE_DATA_TYPES) and, here, at the schema
-- layer too — belt and suspenders, so a future application change can't quietly start
-- storing it for the wrong type without the database itself rejecting the write.
alter table public.roasts
  add column if not exists profile_data text,
  add column if not exists profile_data_expires_at timestamptz;

alter table public.roasts
  add constraint roasts_profile_data_type_check
  check (profile_data is null or type in ('github', 'instagram'));

-- The two columns are always set or unset together — there is no meaningful "profile
-- data with no expiry" (it would sit forever, which is exactly what retention exists to
-- prevent) or "expiry with no data" state.
alter table public.roasts
  add constraint roasts_profile_data_pairing_check
  check ((profile_data is null) = (profile_data_expires_at is null));

-- No new RLS policies needed: profile_data/profile_data_expires_at are just more columns
-- on a row the existing "roasts: read own"/"roasts: delete own" policies already govern,
-- and every write already goes through the service role key (no INSERT policy on this
-- table at all — see the original migration). Account deletion cascades to this data the
-- same way it already cascades to the rest of a roasts row: `roasts.user_id references
-- auth.users (id) on delete cascade` was already in place before this migration and
-- needs no change — deleting the auth user deletes the whole row, this data included.
--
-- Retention: api/messages.js treats profile_data as absent once
-- profile_data_expires_at has passed (falls back to roast-only chat context, not an
-- error), independent of whether the purge below has actually run yet. Actual deletion —
-- so expired profile data doesn't just sit there forever, logically ignored but still on
-- disk — is a scheduled job, not this migration: see api/cron/purge-expired-profile-data.js
-- and the `crons` entry in vercel.json. That job needs no new policy either; it also
-- writes via the service role key.
create index if not exists roasts_profile_data_expires_at_idx
  on public.roasts (profile_data_expires_at)
  where profile_data_expires_at is not null;
