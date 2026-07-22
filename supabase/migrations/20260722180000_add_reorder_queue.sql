-- Arbitrary drag-to-reorder for the queue. move_queue_item only swaps a pair of
-- neighbors, which can't express dragging an item across several slots. This
-- rewrites positions to a caller-supplied order in one call.
--
-- Only rows belonging to p_room are touched (foreign or stale ids are ignored),
-- so a participant can never reorder another room and a concurrent add/remove
-- won't fail the whole call. queue_items has no UPDATE policy, so this
-- participant-checked SECURITY DEFINER function is the only reorder path.
create or replace function public.reorder_queue(p_room text, p_item_ids uuid[])
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

  if not public.is_room_participant(p_room, uid) then
    raise exception 'not a room participant';
  end if;

  update public.queue_items qi
    set position = ord.idx
    from unnest(p_item_ids) with ordinality as ord(item_id, idx)
    where qi.id = ord.item_id and qi.room_id = p_room;
end;
$$;

revoke execute on function public.reorder_queue(text, uuid[]) from public, anon;
grant execute on function public.reorder_queue(text, uuid[]) to authenticated;
