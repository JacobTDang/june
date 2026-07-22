-- track_resolution and video_cache are populated server-side with the service
-- role. Deny direct client writes so a signed-in user can't poison the shared
-- caches. Reads stay open (the select policies remain).
drop policy if exists track_resolution_insert_authenticated on public.track_resolution;
drop policy if exists track_resolution_update_authenticated on public.track_resolution;
drop policy if exists video_cache_insert_authenticated on public.video_cache;
drop policy if exists video_cache_update_authenticated on public.video_cache;
