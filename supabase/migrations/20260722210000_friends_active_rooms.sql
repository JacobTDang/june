-- Which of my accepted friends are currently in a jam (and which room), so the
-- /friends page can show an "In a jam · Join" affordance. SECURITY DEFINER so it
-- can read room_participants across rooms, but scoped to auth.uid()'s own
-- accepted friends — a caller can never learn a non-friend's whereabouts.
create or replace function public.friends_active_rooms()
returns table (friend uuid, room_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (rp.user_id) rp.user_id, rp.room_id
  from public.room_participants rp
  where rp.user_id in (
    select case when f.requester = auth.uid() then f.addressee else f.requester end
    from public.friendships f
    where f.status = 'accepted' and (f.requester = auth.uid() or f.addressee = auth.uid())
  )
  order by rp.user_id, rp.joined_at desc;
$$;

revoke execute on function public.friends_active_rooms() from public, anon;
grant execute on function public.friends_active_rooms() to authenticated;
