-- Disconnect and delete: one function, one transaction. The delete button
-- used to drop the connection row first and then run four separate deletes;
-- a failure partway left the user disconnected with no delete button to
-- retry, and a sync already in flight could keep writing rows the deletes
-- had already passed. Doing it all inside a single plpgsql function makes it
-- all-or-nothing: a failure leaves the connection in place so the user can
-- retry, and the caller holds the sync lease around the call so no sync is
-- writing at the same time. playlist_songs cascades from playlists, so it
-- isn't listed here. Shared songs rows are not touched: they name no user.

create or replace function public.delete_spotify_data(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.library_songs where user_id = p_user and source = 'spotify';
  delete from public.listens where user_id = p_user and source = 'spotify';
  delete from public.taste_snapshots where user_id = p_user and source = 'spotify';
  delete from public.playlists where user_id = p_user and source = 'spotify';
  delete from public.spotify_connections where user_id = p_user;
end;
$$;

revoke execute on function public.delete_spotify_data(uuid) from public, anon, authenticated;
grant execute on function public.delete_spotify_data(uuid) to service_role;
