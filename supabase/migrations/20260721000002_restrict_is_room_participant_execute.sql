-- is_room_participant is used only inside RLS policies; it doesn't need to be a
-- public/anon RPC. Keep execute for authenticated (required for policy eval).
revoke execute on function public.is_room_participant(text, uuid) from public;
grant execute on function public.is_room_participant(text, uuid) to authenticated;
