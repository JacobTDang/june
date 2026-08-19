-- room_participants has UNIQUE (user_id): one room per person. joinRoom already
-- honours that with an upsert on conflict — "entering a room moves you here
-- from any previous one" — but create_room did a plain insert, so it never did.
--
-- That went unnoticed while the resume card offered "Return" for any room you
-- held a membership in: you always went back rather than starting fresh. Once
-- the card started hiding rooms with no life left in them, the page began
-- offering "Start a jam" to people still holding a membership from a dead room,
-- and the insert collided — unable to resume, unable to start.
create or replace function public.create_room(p_code text, p_name text)
returns void
language plpgsql
set search_path = ''
as $function$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  insert into public.rooms (id, host_id) values (p_code, uid);
  -- Leave whatever room you were in first. The room you leave behind is swept
  -- once it is empty, exactly as when you join someone else's room instead.
  delete from public.room_participants where user_id = uid;
  insert into public.room_participants (room_id, user_id, name) values (p_code, uid, p_name);
end;
$function$;
