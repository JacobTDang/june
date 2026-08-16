-- A fresh id on every promotion, so advancing can target the exact copy of a
-- track it means. Without it, two pending copies of the same video are
-- indistinguishable — every column matches, including a NULL started_at — and
-- concurrent clients timing out on the first could advance past the second.
alter table public.rooms
  add column if not exists now_playing_instance uuid;
