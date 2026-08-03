-- Chat for the people in a room. Scoped exactly like the queue: only a
-- participant can read or write, and only as themselves. Messages die with
-- the room (the last participant leaving already tears the room down, and
-- this cascades off it).
create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references public.rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint room_messages_body_length check (char_length(body) between 1 and 500)
);

-- The log is always read newest-first for one room, then reversed for display.
create index if not exists room_messages_room_created_idx
  on public.room_messages (room_id, created_at desc, id desc);

alter table public.room_messages enable row level security;

drop policy if exists room_messages_select on public.room_messages;
create policy room_messages_select on public.room_messages for select to authenticated
  using (public.is_room_participant(room_id, auth.uid()));

drop policy if exists room_messages_insert on public.room_messages;
create policy room_messages_insert on public.room_messages for insert to authenticated
  with check (public.is_room_participant(room_id, auth.uid()) and user_id = auth.uid());

-- No update or delete policy on purpose: what was said in the room stays as
-- said. Deleting the room still removes it via the cascade above.

-- Deliver new messages over Realtime. RLS applies to postgres_changes too, so
-- a subscriber only receives rows for rooms they're actually in.
alter publication supabase_realtime add table public.room_messages;
