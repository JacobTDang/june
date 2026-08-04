-- A bio is written to be read, including by people who aren't signed in — so
-- it belongs in the same SECURITY DEFINER lookup that already exposes the
-- name, handle and avatar. Nothing else is added: taste stays behind RLS.
drop function if exists public.public_profile(public.citext);

create function public.public_profile(handle public.citext)
returns table (id uuid, username public.citext, display_name text, avatar_url text, bio text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name, p.avatar_url, p.bio
  from public.profiles p
  where p.username = handle
  limit 1;
$$;

revoke execute on function public.public_profile(public.citext) from public;
grant execute on function public.public_profile(public.citext) to anon, authenticated;
