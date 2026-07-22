-- Red-team fixes for the friends feature.

-- Finding 2: friend requests must start pending (no inserting an accepted row).
drop policy if exists friendships_insert_own on public.friendships;
create policy friendships_insert_own on public.friendships for insert to authenticated
  with check (auth.uid() = requester and requester <> addressee and status = 'pending');

-- Only the addressee may accept, and only a pending request.
drop policy if exists friendships_update_own on public.friendships;
create policy friendships_update_own on public.friendships for update to authenticated
  using (auth.uid() = addressee and status = 'pending')
  with check (auth.uid() = addressee and status = 'accepted');

-- Belt-and-suspenders: the pair is immutable and the only transition is
-- pending -> accepted, so requester/addressee can't be rewritten.
create or replace function public.friendships_guard_update()
returns trigger language plpgsql as $$
begin
  if new.requester is distinct from old.requester
     or new.addressee is distinct from old.addressee then
    raise exception 'friendship participants are immutable';
  end if;
  if not (old.status = 'pending' and new.status = 'accepted') then
    raise exception 'only pending -> accepted is allowed';
  end if;
  return new;
end;
$$;

drop trigger if exists friendships_guard_update on public.friendships;
create trigger friendships_guard_update
  before update on public.friendships
  for each row execute function public.friendships_guard_update();

-- Finding 1: let anyone (incl. signed-out) look up a single public profile by
-- handle, without opening the whole profiles table to anon enumeration.
create or replace function public.public_profile(handle citext)
returns table (id uuid, username citext, display_name text, avatar_url text)
language sql
security definer
set search_path = public
stable
as $$
  select id, username, display_name, avatar_url
  from public.profiles
  where username = handle
  limit 1;
$$;

revoke all on function public.public_profile(citext) from public;
grant execute on function public.public_profile(citext) to anon, authenticated;
