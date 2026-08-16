-- The "You're in a jam · Return" card read membership alone, so it offered to
-- return you to a room you left days ago. Membership is the wrong question;
-- the right one is whether that room still has life in it — someone seen
-- recently, or a track actually playing. The second half matters: if you close
-- your laptop while friends carry on, Return should still work.
create or replace function public.my_active_room()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select rp.room_id
  from public.room_participants rp
  join public.rooms r on r.id = rp.room_id
  where rp.user_id = auth.uid()
    and (
      exists (
        select 1 from public.room_participants p
        where p.room_id = rp.room_id
          and p.last_seen_at > now() - interval '5 minutes'
      )
      or public.room_is_live(
        r.now_playing_video_id, r.now_playing_started_at,
        r.now_playing_duration_ms, (extract(epoch from now()) * 1000)::bigint)
    )
  limit 1;
$$;

revoke execute on function public.my_active_room() from public, anon;
grant execute on function public.my_active_room() to authenticated;
