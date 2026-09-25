-- When a sync last started for this connection. Runs take the users who
-- waited longest first, so a run cut short by the function time limit can't
-- skip the same users every time. An attempt newer than both last_synced_at
-- and last_error_at means the previous run was cut off before it finished,
-- and the next run records that. Sync now is gated on the last attempt rather
-- than the last success, so a failing sync can't be retried without a pause.

alter table public.spotify_connections add column if not exists last_attempt_at timestamptz;
