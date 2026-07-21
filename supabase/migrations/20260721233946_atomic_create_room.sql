-- Create a room and its host participant in one transaction, so a room can
-- never briefly exist with zero participants (which the sweep/leave_room logic
-- would treat as an empty, deletable room). SECURITY INVOKER so the existing
-- RLS insert checks (host_id = auth.uid(), user_id = auth.uid()) still apply.
-- Raises unique_violation (23505) on a code collision; the caller retries.
create or replace function public.create_room(p_code text, p_name text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  insert into public.rooms (id, host_id) values (p_code, uid);
  insert into public.room_participants (room_id, user_id, name) values (p_code, uid, p_name);
end;
$$;

revoke execute on function public.create_room(text, text) from anon;
grant execute on function public.create_room(text, text) to authenticated;
