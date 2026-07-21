-- Advisor 0011: pin the trigger function's search_path.
create or replace function public.friendships_guard_update()
returns trigger
language plpgsql
set search_path = ''
as $$
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
