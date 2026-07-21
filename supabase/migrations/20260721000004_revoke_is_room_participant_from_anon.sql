-- The earlier `revoke ... from public` was a no-op: Supabase grants execute to
-- anon/authenticated/service_role explicitly. Remove anon directly so the helper
-- (used only inside RLS policies for authenticated) isn't a membership-probe RPC.
revoke execute on function public.is_room_participant(text, uuid) from anon;
