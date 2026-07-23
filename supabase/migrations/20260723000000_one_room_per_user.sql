-- Enforce one active room per user: a signing-in user resumes their single room
-- instead of sitting in several at once (a second device rejoins the same room).

-- Dedupe first: keep each user's most-recently-joined room.
delete from public.room_participants rp
where rp.ctid in (
  select ctid from (
    select ctid, row_number() over (partition by user_id order by joined_at desc, ctid desc) as rn
    from public.room_participants
  ) ranked
  where rn > 1
);

alter table public.room_participants
  add constraint room_participants_user_id_key unique (user_id);
