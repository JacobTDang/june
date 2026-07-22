-- Soft cap on how many people can hold a seat in the app (a profile row = a
-- seat). Enforced at the OAuth callback, which calls this with the service role
-- and a trusted cap — so it is service_role only; a client can't call it with a
-- fake cap to let themselves in.
--
-- Members (anyone who already has a profile) are always admitted, even once the
-- cap is reached. An advisory lock serializes concurrent first-time sign-ins so
-- the last seat can't be double-booked.
create or replace function public.claim_seat(p_user uuid, p_max int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user is null then
    return false;
  end if;

  if exists (select 1 from public.profiles where id = p_user) then
    return true; -- already a member
  end if;

  perform pg_advisory_xact_lock(hashtext('june_signup_cap')::bigint);

  if (select count(*) from public.profiles) >= p_max then
    return false; -- full
  end if;

  insert into public.profiles (id, display_name)
  values (
    p_user,
    (select coalesce(
       nullif(u.raw_user_meta_data->>'full_name', ''),
       nullif(u.raw_user_meta_data->>'name', ''),
       nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
       'friend'
     )
     from auth.users u
     where u.id = p_user)
  )
  on conflict (id) do nothing;

  return true;
end;
$$;

revoke execute on function public.claim_seat(uuid, int) from public, anon, authenticated;
grant execute on function public.claim_seat(uuid, int) to service_role;
