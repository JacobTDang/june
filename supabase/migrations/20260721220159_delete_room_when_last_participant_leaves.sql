-- Leaving a room removes the caller's participant row, and if that was the last
-- participant, tears the room down entirely (queue_items + room_participants
-- cascade). SECURITY DEFINER because after removing their own participant row
-- the caller is no longer a participant, so an RLS-scoped room delete would be
-- blocked. Identity comes from auth.uid(), never a caller-supplied argument.
create or replace function public.leave_room(p_room text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  delete from public.room_participants
    where room_id = p_room and user_id = uid;

  delete from public.rooms r
    where r.id = p_room
      and not exists (
        select 1 from public.room_participants p where p.room_id = p_room
      );
end;
$$;

revoke execute on function public.leave_room(text) from public;
grant execute on function public.leave_room(text) to authenticated;
