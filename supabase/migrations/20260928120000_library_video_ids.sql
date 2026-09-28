-- The audio mp3server keeps at home (phase 3): every matched video reachable
-- from anyone's liked songs or playlists. june sends this whole set as
-- mp3server's keep list at the end of every sync run.
-- Spec: docs/superpowers/specs/2026-09-25-spotify-library-design.md.
--
-- One array rather than a set of rows: PostgREST caps a select at 1000 rows,
-- and a keep list is every song in five libraries.
create or replace function public.library_video_ids()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct s.video_id order by s.video_id), '{}')
  from public.songs s
  where s.match_state = 'matched'
    and s.video_id is not null
    and (
      exists (select 1 from public.library_songs l where l.song_id = s.id)
      or exists (select 1 from public.playlist_songs p where p.song_id = s.id)
    );
$$;

revoke execute on function public.library_video_ids() from public, anon, authenticated;
grant execute on function public.library_video_ids() to service_role;
