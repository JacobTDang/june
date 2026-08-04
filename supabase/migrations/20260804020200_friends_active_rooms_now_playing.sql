-- Extend friend presence with what they're actually listening to, so the home
-- page can say "Esther · Glory Box" rather than just "in a jam".
--
-- The scoping is unchanged and still the point: SECURITY DEFINER to read across
-- rooms, but restricted to auth.uid()'s accepted friends, so a caller can never
-- learn a non-friend's whereabouts — now or what they're playing.
--
-- Return type changes, so the old function has to go first.
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
  where rp.user_id in (
    select case when f.requester = auth.uid() then f.addressee else f.requester end
    from public.friendships f
    where f.status = 'accepted' and (f.requester = auth.uid() or f.addressee = auth.uid())
  )
  order by rp.user_id, rp.joined_at desc;
$$;

revoke execute on function public.friends_active_rooms() from public, anon;
grant execute on function public.friends_active_rooms() to authenticated;
