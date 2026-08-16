-- "In a jam" was derived from membership, which has no liveness in it. A
-- participant row is only removed by the Leave button or by the room being
-- swept 12 hours after its last playback — so closing a tab left a friend
-- showing as in a jam for the rest of the day. The room's own participant list
-- was never wrong, because it uses Realtime presence; only the friends list
-- had nothing to go on.
alter table public.room_participants
  add column if not exists last_seen_at timestamptz not null default now();

create index if not exists room_participants_last_seen_idx
  on public.room_participants (last_seen_at desc);

create or replace function public.touch_participant(p_room text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.room_participants
  set last_seen_at = now()
  where room_id = p_room and user_id = auth.uid();
$$;

revoke execute on function public.touch_participant(text) from public, anon;
grant execute on function public.touch_participant(text) to authenticated;

-- Friend presence now means "seen recently", not "has a row". Five minutes is
-- deliberately generous: a phone playing with the screen off throttles timers
-- to roughly one a minute, and it is still in the jam.
drop function if exists public.friends_active_rooms();

create function public.friends_active_rooms()
returns table (
  friend uuid,
  room_id text,
  now_playing_title text,
  now_playing_artist text,
  now_playing_thumbnail_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (rp.user_id)
    rp.user_id,
    rp.room_id,
    r.now_playing_title,
    r.now_playing_artist,
    r.now_playing_thumbnail_url
  from public.room_participants rp
  join public.rooms r on r.id = rp.room_id
  where rp.last_seen_at > now() - interval '5 minutes'
    and rp.user_id in (
      select case when f.requester = auth.uid() then f.addressee else f.requester end
      from public.friendships f
      where f.status = 'accepted' and (f.requester = auth.uid() or f.addressee = auth.uid())
    )
  order by rp.user_id, rp.joined_at desc;
$$;

revoke execute on function public.friends_active_rooms() from public, anon;
grant execute on function public.friends_active_rooms() to authenticated;
