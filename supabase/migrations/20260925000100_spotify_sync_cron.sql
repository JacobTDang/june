-- Sync every connected Spotify library every 30 minutes.
--
-- Spotify keeps only a user's last 50 plays, so the interval is what decides
-- how much listening can go unrecorded; 30 minutes means more than 50 plays in
-- half an hour, which the sync logs when it happens.
--
-- The bearer secret is read from Vault. It is created by hand in the SQL
-- editor and never committed:
--   select vault.create_secret('<SPOTIFY_SYNC_SECRET>', 'spotify_sync_secret');
-- The route answers 202 and syncs after responding, so the 10-second timeout
-- only has to cover the handshake.
create extension if not exists pg_net;

select cron.schedule(
  'spotify-sync',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://june-jam.vercel.app/api/spotify/sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets where name = 'spotify_sync_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
