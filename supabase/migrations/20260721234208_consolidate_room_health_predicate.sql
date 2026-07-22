-- Single source of truth for room liveness/staleness. Previously the rule lived
-- in TS (dashboard counts) and again inline in sweep_dead_rooms (deletion),
-- which could drift. The deletion must run in SQL (the cron), so SQL is
-- canonical: these scalar helpers are shared by the sweep and the counts.

-- Is the room's current track still within its runtime?
create or replace function public.room_is_live(
  p_video text, p_started bigint, p_duration integer, p_now_ms bigint
) returns boolean language sql immutable set search_path = '' as $$
  select p_video is not null and p_started is not null and p_duration is not null
     and p_started + p_duration > p_now_ms;
$$;

-- Most recent sign of life: the last track start, or failing that, creation.
create or replace function public.room_last_activity_ms(
  p_created timestamptz, p_started bigint
) returns bigint language sql immutable set search_path = '' as $$
  select greatest((extract(epoch from p_created) * 1000)::bigint, coalesce(p_started, 0));
$$;

-- Safe to sweep: not live, and untouched past the TTL.
create or replace function public.room_is_stale(
  p_created timestamptz, p_video text, p_started bigint, p_duration integer,
  p_now_ms bigint, p_ttl_ms bigint
) returns boolean language sql immutable set search_path = '' as $$
  select not public.room_is_live(p_video, p_started, p_duration, p_now_ms)
     and (p_now_ms - public.room_last_activity_ms(p_created, p_started)) > p_ttl_ms;
$$;

-- Dashboard counts, computed in one bounded query instead of pulling every room
-- row into the app. Shares the exact predicate the sweep deletes on.
create or replace function public.room_health(p_ttl_ms bigint default 43200000)
returns table(total bigint, active bigint, stale bigint)
language sql stable security definer set search_path = '' as $$
  select
    count(*),
    count(*) filter (where public.room_is_live(
      now_playing_video_id, now_playing_started_at, now_playing_duration_ms,
      (extract(epoch from now()) * 1000)::bigint)),
    count(*) filter (where public.room_is_stale(
      created_at, now_playing_video_id, now_playing_started_at, now_playing_duration_ms,
      (extract(epoch from now()) * 1000)::bigint, p_ttl_ms))
  from public.rooms;
$$;

-- Re-point the sweep at the shared predicate.
create or replace function public.sweep_dead_rooms(p_ttl_ms bigint default 43200000)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
  deleted integer;
begin
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

-- Internal helpers + counts: not for end users.
revoke execute on function public.room_is_live(text, bigint, integer, bigint) from anon, authenticated;
revoke execute on function public.room_last_activity_ms(timestamptz, bigint) from anon, authenticated;
revoke execute on function public.room_is_stale(timestamptz, text, bigint, integer, bigint, bigint) from anon, authenticated;
revoke execute on function public.room_health(bigint) from anon, authenticated;
grant execute on function public.room_health(bigint) to service_role;
