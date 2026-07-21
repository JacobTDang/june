-- Safety net for rooms orphaned when leave_room never fires (tab close, crash,
-- mobile background-kill). Deletes rooms with no live playback that have been
-- idle past the TTL. Predicate mirrors deadRoomIds() in src/lib/room/lifecycle.ts
-- (default TTL 12h = 43_200_000 ms) — keep the two in sync.
create extension if not exists pg_cron;

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
  with gone as (
    delete from public.rooms r
    where not (
      r.now_playing_video_id is not null
      and r.now_playing_started_at is not null
      and r.now_playing_duration_ms is not null
      and r.now_playing_started_at + r.now_playing_duration_ms > now_ms
    )
    and (
      now_ms - greatest(
        (extract(epoch from r.created_at) * 1000)::bigint,
        coalesce(r.now_playing_started_at, 0)
      )
    ) > p_ttl_ms
    returning 1
  )
  select count(*) into deleted from gone;
  return deleted;
end;
$$;

revoke execute on function public.sweep_dead_rooms(bigint) from public;
grant execute on function public.sweep_dead_rooms(bigint) to service_role;

-- Run hourly. cron.schedule upserts by job name, so re-applying is safe.
select cron.schedule('sweep-dead-rooms', '0 * * * *', $$ select public.sweep_dead_rooms(); $$);
