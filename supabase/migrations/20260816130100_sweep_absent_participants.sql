-- The hourly sweep only removed rooms 12 hours after their last playback, so a
-- room whose listeners all closed their tabs stayed alive — and kept showing
-- them as present — for the rest of the day. Now it also drops participants
-- who have not been seen for two hours, and removes rooms nobody is left in.
create or replace function public.sweep_dead_rooms(p_ttl_ms bigint default 43200000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  deleted integer;
begin
  delete from public.room_participants
  where last_seen_at < now() - interval '2 hours';

  -- Empty rooms go, with a grace period so a room can't be swept in the
  -- moment between being created and its host being counted.
  delete from public.rooms r
  where r.created_at < now() - interval '10 minutes'
    and not exists (
      select 1 from public.room_participants p where p.room_id = r.id
    );

  with gone as (
    delete from public.rooms r
    where public.room_is_stale(
      r.created_at, r.now_playing_video_id, r.now_playing_started_at,
      r.now_playing_duration_ms, now_ms, p_ttl_ms)
    returning 1
  )
  select count(*) into deleted from gone;
  return deleted;
end;
$$;
