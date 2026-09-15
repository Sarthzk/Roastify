-- Chat backend: a signed-in user can continue a conversation in the same persona voice
-- that produced one of their roasts. Builds on the roasts/reports schema from
-- 20260912000000_roasts_and_reports.sql — see CLAUDE.md's "Chat" section.

-- Idempotent, same as the prior migration — harmless to redeclare if this file is ever
-- applied on its own (e.g. pasted into the SQL editor) rather than after the first one.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- conversations
-- ---------------------------------------------------------------------------
-- roast_id is nullable deliberately: a future debate-mode feature reuses these same two
-- tables with no roast attached (a conversation not anchored to any prior roast). Nothing
-- for that is built yet — this is just leaving the column able to be null rather than
-- needing a schema change later. Every conversation created today (api/conversations.js)
-- always sets it, so it's `on delete cascade`: if the underlying roast is deleted (see
-- api/history.js), a conversation whose entire context was that roast has nothing left to
-- be about, so it goes with it rather than being left dangling.
--
-- persona is copied from the roast at creation time and never changes afterward — it's
-- what "locks" the conversation to the voice that produced the roast (api/messages.js
-- always reads it from here, never from a client-sent value).
--
-- user_id is `on delete cascade`, same as roasts.user_id — deleting an account removes
-- every conversation attached to it (api/account.js), not a second manual step that could
-- fail out of sync with the account deletion. Unlike roasts.user_id, this one is NOT
-- nullable: unlike an anonymous roast (stored for analytics), there is no anonymous chat
-- — api/messages.js and api/conversations.js are signed-in only end to end.
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  roast_id uuid references public.roasts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  persona text not null,
  created_at timestamptz not null default now()
);

create index if not exists conversations_user_id_idx on public.conversations (user_id);
create index if not exists conversations_roast_id_idx on public.conversations (roast_id);

alter table public.conversations enable row level security;

create policy "conversations: read own" on public.conversations
  for select
  using (auth.uid() = user_id);

create policy "conversations: delete own" on public.conversations
  for delete
  using (auth.uid() = user_id);

-- Deliberately no INSERT (or UPDATE) policy for anon/authenticated: every conversation is
-- created server-side via the service role key (api/conversations.js), after verifying
-- the roast_id actually belongs to the caller's own JWT — same pattern as roasts.

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
-- No user_id column here on purpose — ownership is always "whoever owns the parent
-- conversation," so the RLS policies below join back to conversations.user_id instead of
-- duplicating it onto every row. `on delete cascade` on conversation_id means deleting a
-- conversation (api/conversations.js) removes its messages by Postgres itself, not a
-- second manual delete step.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_conversation_id_idx on public.messages (conversation_id);
create index if not exists messages_created_at_idx on public.messages (created_at);

alter table public.messages enable row level security;

create policy "messages: read own" on public.messages
  for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

create policy "messages: delete own" on public.messages
  for delete
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.user_id = auth.uid()
    )
  );

-- Deliberately no INSERT (or UPDATE) policy: every message (both the user's own and the
-- model's reply) is written server-side via the service role key
-- (api/_lib/persistChatTurn.js), after the model has already generated and streamed the
-- reply — never directly by a client against PostgREST.
