-- Defense in depth: record_youtube_units is only ever called with the service
-- role. RLS on youtube_usage already blocks anon/authenticated writes, but the
-- function still carries the default PUBLIC execute grant. Revoke it so the
-- function isn't callable by untrusted roles at all.
revoke execute on function public.record_youtube_units(date, text, integer) from public;
