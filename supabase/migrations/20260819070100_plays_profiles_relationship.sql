-- The home page asks for a play's listener name with an embedded
-- `profiles(display_name)`, but plays.user_id referenced auth.users, and
-- PostgREST can only embed along a foreign key between two exposed tables.
-- Every read of the listening history 400'd with PGRST200, which surfaced as a
-- Server Components render error where those sections should be.
--
-- profiles.id is itself auth.users(id), so this narrows the reference rather
-- than widening it: every user_id already had a matching profile row.
alter table public.plays
  add constraint plays_user_id_profiles_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;
