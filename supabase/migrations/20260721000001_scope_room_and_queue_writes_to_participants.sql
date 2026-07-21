-- Membership helper for the write policies below.
create or replace function public.is_room_participant(p_room text, p_user uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.room_participants
    where room_id = p_room and user_id = p_user
  );
$$;

-- rooms: you may only create a room you host, and only a participant may change
-- its now-playing state (closes "any signed-in user can hijack any room").
drop policy if exists rooms_insert on public.rooms;
create policy rooms_insert on public.rooms for insert to authenticated
  with check (host_id = auth.uid());

drop policy if exists rooms_update on public.rooms;
create policy rooms_update on public.rooms for update to authenticated
  using (public.is_room_participant(id, auth.uid()))
  with check (public.is_room_participant(id, auth.uid()));

-- queue_items: only a participant may add (as themselves) or remove tracks.
drop policy if exists queue_insert on public.queue_items;
create policy queue_insert on public.queue_items for insert to authenticated
  with check (public.is_room_participant(room_id, auth.uid()) and added_by = auth.uid());

drop policy if exists queue_delete on public.queue_items;
create policy queue_delete on public.queue_items for delete to authenticated
  using (public.is_room_participant(room_id, auth.uid()));
