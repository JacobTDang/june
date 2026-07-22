-- `create function` grants EXECUTE to PUBLIC by default, so revoking from
-- anon/authenticated alone left these reachable via the PUBLIC grant. Remove it.
-- room_health (SECURITY DEFINER, reads all rooms) must be service-role only;
-- create_room stays authenticated; the scalar helpers are internal (called by
-- the SECURITY DEFINER functions as the owner, so they need no role grants).
revoke execute on function public.room_health(bigint) from public;
revoke execute on function public.create_room(text, text) from public;
revoke execute on function public.room_is_live(text, bigint, integer, bigint) from public;
revoke execute on function public.room_last_activity_ms(timestamptz, bigint) from public;
revoke execute on function public.room_is_stale(timestamptz, text, bigint, integer, bigint, bigint) from public;
