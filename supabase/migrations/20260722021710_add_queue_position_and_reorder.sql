-- Give the queue an explicit order key so items can be reordered (previously
-- ordered by created_at). A sequence default keeps insertion order and avoids
-- the collisions a now()-based default would cause on batch inserts.
create sequence if not exists public.queue_position_seq;

alter table public.queue_items
  add column if not exists position bigint not null default nextval('public.queue_position_seq');

create index if not exists queue_items_room_position_idx
  on public.queue_items (room_id, position);

-- Reorder one item up/down by swapping its position with its neighbor. There is
-- no UPDATE policy on queue_items (clients can't mutate queue rows directly), so
-- this SECURITY DEFINER function is the only reorder path — and it verifies the
-- caller is a participant of the item's room. Atomic: the swap is one call.
create or replace function public.move_queue_item(p_item uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  v_room text;
  v_pos bigint;
  nbr_id uuid;
  nbr_pos bigint;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;

  select room_id, position into v_room, v_pos
    from public.queue_items where id = p_item;
  if v_room is null then
    return; -- item already gone (e.g. it started playing); no-op
  end if;

  if not public.is_room_participant(v_room, uid) then
    raise exception 'not a room participant';
  end if;

  if p_direction = 'up' then
    select id, position into nbr_id, nbr_pos from public.queue_items
      where room_id = v_room and position < v_pos order by position desc limit 1;
  elsif p_direction = 'down' then
    select id, position into nbr_id, nbr_pos from public.queue_items
      where room_id = v_room and position > v_pos order by position asc limit 1;
  else
    raise exception 'invalid direction: %', p_direction;
  end if;

  if nbr_id is null then
    return; -- already at the top/bottom; no-op
  end if;

  update public.queue_items set position = nbr_pos where id = p_item;
  update public.queue_items set position = v_pos where id = nbr_id;
end;
$$;

revoke execute on function public.move_queue_item(uuid, text) from public, anon;
grant execute on function public.move_queue_item(uuid, text) to authenticated;
