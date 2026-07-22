create extension if not exists citext;

-- Unique, case-insensitive handle for search + shareable /u/<username> links.
alter table public.profiles
  add column if not exists username citext unique;

-- Defense-in-depth format guard (app normalizes/validates too): starts with a
-- letter, 3-20 chars, lowercase letters/digits/underscore only.
alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles
  add constraint profiles_username_format
  check (username is null or username::text ~ '^[a-z][a-z0-9_]{2,19}$');
