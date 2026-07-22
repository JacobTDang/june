create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester uuid not null references auth.users (id) on delete cascade,
  addressee uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester <> addressee)
);

-- Exactly one row per pair, whichever direction the request went.
create unique index if not exists friendships_pair_unique
  on public.friendships (least(requester, addressee), greatest(requester, addressee));

alter table public.friendships enable row level security;

-- You can only see, create, accept, or remove friendships you're part of, and
-- you can only create a request as yourself.
drop policy if exists friendships_select_own on public.friendships;
create policy friendships_select_own on public.friendships for select to authenticated
  using (auth.uid() = requester or auth.uid() = addressee);

drop policy if exists friendships_insert_own on public.friendships;
create policy friendships_insert_own on public.friendships for insert to authenticated
  with check (auth.uid() = requester and requester <> addressee);

drop policy if exists friendships_update_own on public.friendships;
create policy friendships_update_own on public.friendships for update to authenticated
  using (auth.uid() = requester or auth.uid() = addressee)
  with check (auth.uid() = requester or auth.uid() = addressee);

drop policy if exists friendships_delete_own on public.friendships;
create policy friendships_delete_own on public.friendships for delete to authenticated
  using (auth.uid() = requester or auth.uid() = addressee);
