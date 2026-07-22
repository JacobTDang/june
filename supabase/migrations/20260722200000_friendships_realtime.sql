-- Deliver friendship changes over Realtime so an in-room friend-request toast
-- can appear the moment a request lands. RLS on friendships still applies to
-- postgres_changes, so a subscriber only receives rows where they are the
-- requester or addressee.
alter publication supabase_realtime add table public.friendships;
