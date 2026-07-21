-- Supabase grants EXECUTE to anon/authenticated/service_role explicitly via
-- default privileges, so `revoke ... from public` on a new function is a no-op.
-- Revoke the explicit grants that shouldn't be there.
--
-- sweep_dead_rooms: service role only. The cron job runs as the owner; the
-- owner metrics button calls it with the service role. No end user should be
-- able to trigger a mass room deletion.
revoke execute on function public.sweep_dead_rooms(bigint) from anon, authenticated;

-- leave_room: signed-in users only (they can leave rooms). It only ever removes
-- the caller's own participant row (auth.uid()) and deletes the room if that
-- emptied it, so authenticated execute is safe — but anon never needs it.
revoke execute on function public.leave_room(text) from anon;
