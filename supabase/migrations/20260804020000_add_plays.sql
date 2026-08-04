-- What people actually listened to.
--
-- Until now june remembered nothing past a jam: queue_items rows are deleted
-- the moment a track starts playing, rooms.now_playing_* is overwritten in
-- place, and the room itself is deleted when the last person leaves. This is
-- the first table that outlives a room.
--
-- One row per listener per play, written server-side when a track ends, so the
-- table also records who heard what together — otherwise unrecoverable once
-- room_participants cascades away.
create table if not exists public.plays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Deliberately not a foreign key: rooms are deleted routinely (leave_room,
  -- the hourly dead-room sweep) and the history has to outlive them.
  room_id text not null,
  video_id text not null,
  -- Snapshotted rather than joined: video_cache is a global cache that evicts,
  -- and a play should still read correctly years later.
  title text not null,
  artist text,
  thumbnail_url text,
  -- Present for tracks added through search (iTunes gives them free); null for
  -- pasted links and playlist imports, where only a channel name is known.
  genre text,
  artist_id text,
  played_at timestamptz not null default now(),
  listened_ms integer not null default 0,
  duration_ms integer not null default 0,
  skipped boolean not null default false,
  added_by uuid references auth.users(id) on delete set null
);

create index if not exists plays_user_played_idx on public.plays (user_id, played_at desc);
create index if not exists plays_room_idx on public.plays (room_id);
-- Top-artist rollups group by this.
create index if not exists plays_user_artist_idx on public.plays (user_id, artist);

alter table public.plays enable row level security;

-- "Anyone you jammed with can see what you played." Because every listener
-- present gets their own row for the same play, sharing a room is recorded by
-- this table itself and stays checkable after the room is gone.
--
-- SECURITY DEFINER for the same reason is_room_participant is: a policy that
-- queries its own table directly would recurse.
create or replace function public.shared_a_room(p_room text, p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.plays
    where room_id = p_room and user_id = p_user
  );
$$;

revoke execute on function public.shared_a_room(text, uuid) from public, anon;
grant execute on function public.shared_a_room(text, uuid) to authenticated;

drop policy if exists plays_select on public.plays;
create policy plays_select on public.plays for select to authenticated
  using (user_id = auth.uid() or public.shared_a_room(room_id, auth.uid()));

-- No insert/update/delete policies on purpose. Plays are written server-side
-- with the service role, like the other shared tables, so nobody can invent a
-- listening history for themselves or anyone else — and a play, once it
-- happened, is not editable.
