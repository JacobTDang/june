-- Library matching writes back onto songs through these two functions.
-- Spec: docs/superpowers/specs/2026-09-25-spotify-library-design.md (phase 2).
--
-- Both are one statement over many rows. PostgREST can't give each row of an
-- update its own values, and doing it row by row would be hundreds of calls
-- per sync run. Service role only, like every other write to songs.

-- A batch was submitted as import p_job; each song's index in the request is
-- its position there, which is how results are matched back. Songs that
-- stopped being pending meanwhile (matched on a click) are left alone.
create or replace function public.mark_songs_matching(p_job uuid, p_song_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.songs s
  set match_state = 'matching', match_job_id = p_job, match_position = x.ord - 1
  from unnest(p_song_ids) with ordinality as x(song_id, ord)
  where s.id = x.song_id and s.match_state = 'pending';
$$;

-- Results onto songs. Each element: {song_id, state, video_id,
-- video_duration_ms, confidence}; the video fields are null unless matched.
create or replace function public.apply_song_matches(p_updates jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.songs s
  set match_state = u.state,
      video_id = case when u.state = 'matched' then u.video_id end,
      video_duration_ms = case when u.state = 'matched' then u.video_duration_ms end,
      match_confidence = case when u.state = 'matched' then u.confidence end,
      matched_at = case when u.state in ('matched', 'not_found', 'failed') then now() end,
      match_job_id = null,
      match_position = null
  from jsonb_to_recordset(p_updates)
    as u(song_id uuid, state text, video_id text, video_duration_ms integer, confidence text)
  where s.id = u.song_id;
$$;

revoke execute on function public.mark_songs_matching(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.mark_songs_matching(uuid, uuid[]) to service_role;
revoke execute on function public.apply_song_matches(jsonb) from public, anon, authenticated;
grant execute on function public.apply_song_matches(jsonb) to service_role;
