-- The first track of an idle room never becomes a queue_items row: enqueueTrack
-- writes it straight into rooms.now_playing_*, where only the adder's *name*
-- was kept. Without this, every room's opening track records a null added_by.
alter table public.rooms
  add column if not exists now_playing_added_by uuid references auth.users(id) on delete set null;

-- A line about yourself on /u/<handle>. Length is enforced in the app the same
-- way display_name is; the constraint here is the backstop.
alter table public.profiles
  add column if not exists bio text;

alter table public.profiles
  drop constraint if exists profiles_bio_length;
alter table public.profiles
  add constraint profiles_bio_length check (bio is null or char_length(bio) <= 160);
