-- Lyrics fetched for a track, cached so a repeat play costs no provider call.
-- Shared across rooms: the lyrics for a video are the same for everyone.
--
-- A row with both columns null is a remembered miss — the provider had
-- nothing. Kept deliberately, so a track with no lyrics isn't looked up again
-- on every play; `fetched_at` lets a later sweep retire stale misses.
create table if not exists public.lyrics_cache (
  video_id text primary key,
  synced_lyrics text,
  plain_lyrics text,
  source text not null,
  fetched_at timestamptz not null default now()
);

alter table public.lyrics_cache enable row level security;

-- Reads are open to signed-in users; writes are service-role only, matching
-- video_cache and track_resolution, so nobody can poison a shared cache.
drop policy if exists lyrics_cache_select on public.lyrics_cache;
create policy lyrics_cache_select on public.lyrics_cache for select to authenticated
  using (true);
