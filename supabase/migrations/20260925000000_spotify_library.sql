-- A Spotify library for each connected user: the songs they like, the
-- playlists they own, what they play, and Spotify's own top lists.
-- Spec: docs/superpowers/specs/2026-09-25-spotify-library-design.md
--
-- Everything here is written by the sync with the service role. Users only
-- read, and only their own rows — except songs, which name no user and are
-- shared, so a song two people like is matched and stored once.

create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('spotify')),
  source_id text not null,
  isrc text,
  title text not null,
  artists text[] not null,
  album text,
  duration_ms integer,
  artwork_url text,
  -- Written by matching (phase 2). The sync never sends these columns, so an
  -- upsert can't reset a song that has already been matched.
  match_state text not null default 'pending'
    check (match_state in ('pending', 'matching', 'matched', 'not_found', 'failed')),
  match_job_id uuid,
  match_position integer,
  video_id text,
  video_duration_ms integer,
  match_confidence text check (match_confidence in ('high', 'low')),
  matched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source, source_id)
);

create index if not exists songs_match_state_idx on public.songs (match_state, created_at);

alter table public.songs enable row level security;
drop policy if exists songs_select on public.songs;
create policy songs_select on public.songs for select to authenticated using (true);

create table if not exists public.spotify_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  spotify_user_id text not null unique,
  display_name text,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'revoked')),
  -- The newest played_at already stored. recently-played only keeps 50 plays,
  -- so this is what stops a play being stored twice.
  recent_cursor timestamptz,
  last_synced_at timestamptz,
  last_daily_sync_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  connected_at timestamptz not null default now()
);

-- No policies on purpose: the tokens are readable by the service role only.
-- The owner reads their status through my_spotify_connection().
alter table public.spotify_connections enable row level security;

create or replace function public.my_spotify_connection()
returns table (
  display_name text,
  status text,
  connected_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  last_error_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select c.display_name, c.status, c.connected_at, c.last_synced_at, c.last_error, c.last_error_at
  from public.spotify_connections c
  where c.user_id = auth.uid();
$$;

revoke execute on function public.my_spotify_connection() from public, anon;
grant execute on function public.my_spotify_connection() to authenticated;

create table if not exists public.library_songs (
  user_id uuid not null references auth.users(id) on delete cascade,
  song_id uuid not null references public.songs(id),
  source text not null check (source in ('spotify')),
  added_at timestamptz not null,
  primary key (user_id, source, song_id)
);

create index if not exists library_songs_user_added_idx
  on public.library_songs (user_id, added_at desc);

alter table public.library_songs enable row level security;
drop policy if exists library_songs_select on public.library_songs;
create policy library_songs_select on public.library_songs for select to authenticated
  using (user_id = auth.uid());

create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('spotify')),
  source_id text not null,
  name text not null,
  description text,
  artwork_url text,
  -- Null until the playlist's songs have been read once. Set together with
  -- them by replace_playlist_songs, so a run that dies half way re-reads it.
  snapshot_id text,
  song_count integer not null default 0,
  synced_at timestamptz,
  unique (user_id, source, source_id)
);

alter table public.playlists enable row level security;
drop policy if exists playlists_select on public.playlists;
create policy playlists_select on public.playlists for select to authenticated
  using (user_id = auth.uid());

create table if not exists public.playlist_songs (
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  position integer not null,
  song_id uuid not null references public.songs(id),
  added_at timestamptz,
  primary key (playlist_id, position)
);

alter table public.playlist_songs enable row level security;
drop policy if exists playlist_songs_select on public.playlist_songs;
create policy playlist_songs_select on public.playlist_songs for select to authenticated
  using (exists (
    select 1 from public.playlists p
    where p.id = playlist_id and p.user_id = auth.uid()
  ));

-- Plays outside june. Kept apart from plays, which means "heard in a june
-- room" and carries room, skip and listened-ms data Spotify doesn't give.
create table if not exists public.listens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  song_id uuid not null references public.songs(id),
  source text not null check (source in ('spotify')),
  played_at timestamptz not null,
  unique (user_id, source, played_at)
);

create index if not exists listens_user_played_idx on public.listens (user_id, played_at desc);

alter table public.listens enable row level security;
drop policy if exists listens_select on public.listens;
create policy listens_select on public.listens for select to authenticated
  using (user_id = auth.uid());

create table if not exists public.taste_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('spotify')),
  kind text not null check (kind in ('artists', 'tracks')),
  time_range text not null check (time_range in ('short_term', 'medium_term', 'long_term')),
  items jsonb not null,
  fetched_at timestamptz not null,
  primary key (user_id, source, kind, time_range)
);

alter table public.taste_snapshots enable row level security;
drop policy if exists taste_snapshots_select on public.taste_snapshots;
create policy taste_snapshots_select on public.taste_snapshots for select to authenticated
  using (user_id = auth.uid());

-- A playlist's songs are replaced whole, and its snapshot recorded only once
-- they are in. PostgREST can't run several statements in one transaction, so
-- this does it as one call.
create or replace function public.replace_playlist_songs(
  p_playlist uuid,
  p_snapshot text,
  p_song_ids uuid[],
  p_added_at timestamptz[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(array_length(p_song_ids, 1), 0) <> coalesce(array_length(p_added_at, 1), 0) then
    raise exception 'replace_playlist_songs: % song ids but % timestamps',
      coalesce(array_length(p_song_ids, 1), 0), coalesce(array_length(p_added_at, 1), 0);
  end if;

  delete from public.playlist_songs where playlist_id = p_playlist;

  insert into public.playlist_songs (playlist_id, position, song_id, added_at)
  select p_playlist, s.ord - 1, s.song_id, s.added_at
  from unnest(p_song_ids, p_added_at) with ordinality as s(song_id, added_at, ord);

  update public.playlists
  set snapshot_id = p_snapshot,
      song_count = coalesce(array_length(p_song_ids, 1), 0),
      synced_at = now()
  where id = p_playlist;

  if not found then
    raise exception 'replace_playlist_songs: no playlist %', p_playlist;
  end if;
end;
$$;

revoke execute on function public.replace_playlist_songs(uuid, text, uuid[], timestamptz[])
  from public, anon, authenticated;
grant execute on function public.replace_playlist_songs(uuid, text, uuid[], timestamptz[])
  to service_role;

-- One sync at a time. The lease expires on its own, so a run that crashes
-- can't hold it forever; the holder id stops a late run releasing a lease
-- someone else has since taken.
create table if not exists public.spotify_sync_lease (
  id integer primary key check (id = 1),
  holder uuid,
  held_until timestamptz not null default '-infinity'
);

insert into public.spotify_sync_lease (id) values (1) on conflict (id) do nothing;

alter table public.spotify_sync_lease enable row level security;

create or replace function public.claim_spotify_sync(p_seconds integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_holder uuid := gen_random_uuid();
begin
  update public.spotify_sync_lease
  set holder = v_holder, held_until = now() + make_interval(secs => p_seconds)
  where id = 1 and held_until < now();
  if found then
    return v_holder;
  end if;
  return null;
end;
$$;

create or replace function public.release_spotify_sync(p_holder uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.spotify_sync_lease
  set holder = null, held_until = now()
  where id = 1 and holder = p_holder;
$$;

revoke execute on function public.claim_spotify_sync(integer) from public, anon, authenticated;
grant execute on function public.claim_spotify_sync(integer) to service_role;
revoke execute on function public.release_spotify_sync(uuid) from public, anon, authenticated;
grant execute on function public.release_spotify_sync(uuid) to service_role;
