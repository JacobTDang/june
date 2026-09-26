# Spotify library: connect, sync, play, keep

**Goal:** a june user connects their Spotify account and june keeps a copy of
their music: liked songs, their playlists, what they listen to, and their top
artists and tracks. Those songs can be queued in any room, and their audio is
kept on the homelab so a library song plays without the "preparing" wait.

## Why a Spotify login, and why only five people

The August import spec (`2026-08-19-music-import-design.md`) ruled out Spotify
OAuth entirely. This reopens it for a small group, knowingly. The limits were
re-checked against Spotify's own docs on 2026-09-25:

- **A Development Mode app allows five authorized users**, and the app owner
  must hold Premium (February 2026 changes, applied to existing apps on
  9 March). Users are added by email in the developer dashboard; they cannot
  sign themselves up. Extended Quota still needs a registered business with
  250k monthly actives.
- **July 2026 raised the limit to 25 Client IDs per developer** but made quota
  count per developer account. Spreading users across several apps to get past
  five is dodging a limit Spotify set on purpose, on the owner's Premium
  account. Not done here.
- **Playlist contents are returned only for playlists the user owns or
  collaborates on.** Followed playlists owned by someone else come back as
  metadata with no items.
- Still available to a Development Mode app: `GET /me`, `/me/tracks`,
  `/me/playlists`, `/playlists/{id}/items`, `/me/top/{type}`,
  `/me/player/recently-played`, `/tracks/{id}`, `/search` (limit 10).
- **Developer Policy bars synced group playback of Spotify content.** Spotify
  supplies metadata only. Audio stays on mp3server, exactly as today.

So the live connection serves you and up to four friends. Every table carries
a `source` column so that routes with no user cap — Spotify's "Download your
data" zip, an Exportify CSV (#85), Last.fm — can feed the same tables later
without a schema change.

## Shape

```
Spotify ──OAuth; sync every 30 min──▶ june  POST /api/spotify/sync   (Vercel)
                                          │  called by pg_cron through pg_net
                                          ▼
                              Supabase: songs, playlists, liked songs,
                                        listens, taste snapshots
                                          │
                  unmatched songs ────────┤──────── the list of audio to keep
                                          ▼
                              mp3server: match song → video (rate-limited),
                                         keep library audio, download slowly
```

june owns the Spotify connection and every piece of user music data. mp3server
owns audio only: finding it, fetching it, keeping it. The homelab never holds a
Supabase key, and a power cut at home pauses matching and downloads without
losing any listening history.

This adds one new direction of traffic: **june's server calls mp3server**
(until now only browsers did). It authenticates with a shared service token.

## Phases

Each phase ships on its own.

1. **Connect + library.** Connect Spotify, sync into Supabase, and a `/library`
   page showing liked songs, playlists, recent listens and connection status.
   Metadata only.
2. **Play from the library.** Background matching of songs to videos, and a
   Library tab in the room's add-music panel. The panel is split into one
   component per tab first.
3. **Keep audio at home.** mp3server keeps library songs out of cache eviction
   and downloads them slowly in the background.

## Out of scope

- Followed playlists owned by others (Spotify won't return their items). Public
  ones can already be pasted as a link.
- Local files and podcast episodes inside playlists.
- Writing anything back to Spotify.
- Showing a library to friends. Every library table is owner-only for now.
- The DJ, and any taste computation beyond storing Spotify's own top lists.
- The Spotify export zip, Exportify CSV, and Last.fm sources. The schema allows
  them; building them is separate work.
- Re-matching a song whose matched video is later taken down (see Follow-ups).

---

## Data model (Supabase)

Conventions follow `plays`: RLS on every table, writes only through the service
role, no insert/update/delete policies.

```sql
-- One row per distinct recording, shared by every user. Matching happens once
-- per song, not once per user who saved it.
songs (
  id                uuid primary key default gen_random_uuid(),
  source            text not null check (source in ('spotify')),
  source_id         text not null,            -- Spotify track id
  isrc              text,
  title             text not null,
  artists           text[] not null,          -- in Spotify's order; [1] is primary
  album             text,
  duration_ms       integer,                  -- Spotify's length
  artwork_url       text,
  match_state       text not null default 'pending'
                    check (match_state in ('pending','matching','matched','not_found','failed')),
  match_job_id      uuid,                     -- mp3server import job while 'matching'
  match_position    integer,                  -- this song's index within that job
  video_id          text,
  video_duration_ms integer,                  -- the matched audio's length
  match_confidence  text check (match_confidence in ('high','low')),
  matched_at        timestamptz,
  created_at        timestamptz not null default now(),
  unique (source, source_id)
)
-- select: any authenticated user

spotify_connections (
  user_id                 uuid primary key references auth.users on delete cascade,
  spotify_user_id         text not null unique,   -- one june user per Spotify account
  display_name            text,
  refresh_token           text not null,
  access_token            text,
  access_token_expires_at timestamptz,
  scopes                  text not null,
  status                  text not null default 'active' check (status in ('active','revoked')),
  recent_cursor           timestamptz,            -- newest played_at stored
  last_synced_at          timestamptz,
  last_daily_sync_at      timestamptz,            -- full liked pass + taste
  last_error              text,
  last_error_at           timestamptz,
  connected_at            timestamptz not null default now()
)
-- no policies: service role only. my_spotify_connection() (SECURITY DEFINER)
-- returns display_name, status, last_synced_at, last_error, last_error_at and
-- connected_at for auth.uid(). Never the tokens.

library_songs (
  user_id  uuid references auth.users on delete cascade,
  song_id  uuid references songs,
  source   text not null check (source in ('spotify')),
  added_at timestamptz not null,
  primary key (user_id, source, song_id)
)

playlists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  source      text not null check (source in ('spotify')),
  source_id   text not null,
  name        text not null,
  description text,
  artwork_url text,
  snapshot_id text,
  song_count  integer not null,
  synced_at   timestamptz not null,
  unique (user_id, source, source_id)
)

playlist_songs (
  playlist_id uuid references playlists on delete cascade,
  position    integer,
  song_id     uuid not null references songs,
  added_at    timestamptz,
  primary key (playlist_id, position)
)
-- select: the playlist's owner

listens (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users on delete cascade,
  song_id   uuid not null references songs,
  source    text not null check (source in ('spotify')),
  played_at timestamptz not null,
  unique (user_id, source, played_at)
)
-- index (user_id, played_at desc)

taste_snapshots (
  user_id    uuid references auth.users on delete cascade,
  source     text not null check (source in ('spotify')),
  kind       text check (kind in ('artists','tracks')),
  time_range text check (time_range in ('short_term','medium_term','long_term')),
  items      jsonb not null,                -- ranked list as Spotify returned it
  fetched_at timestamptz not null,
  primary key (user_id, source, kind, time_range)
)

spotify_sync_lease (
  id         int primary key check (id = 1),
  held_until timestamptz not null
)
-- claim_spotify_sync(seconds) / release_spotify_sync(): service role only
```

Unless noted, library tables are readable by their owner only.

**Decisions**

- **`listens` is not `plays`.** `plays` means "heard in a june room" and carries
  room, skip and listened-ms data that Spotify does not provide. The DJ can read
  both.
- **No table for "audio to keep".** It is every `video_id` reachable from any
  `library_songs` or `playlist_songs` row, computed by a service-role function,
  `library_video_ids()`.
- **Disconnecting keeps the library.** Disconnect deletes the connection row
  (and so the tokens). A separate "Disconnect and delete my Spotify data"
  deletes the user's library, playlists, listens and taste rows as well.
  Shared `songs` rows stay; they name no user.
- **The refresh token is plain text in a service-role-only table, not Vault.**
  The service key already opens the whole database, and every scope is
  read-only: the worst case is someone reading a listening history.
- **`source` is the Spotify id namespace on `songs`,** and the feed that wrote
  the row everywhere else. A new source widens the `check`.

## Connecting

`/library` shows a "Connect Spotify" button when there is no connection.

- `GET /api/spotify/connect` requires a signed-in june user. It stores a random
  `state` in an httpOnly, short-lived cookie and redirects to Spotify's
  authorize endpoint (authorization code flow; the client secret stays on the
  server).
- Scopes: `user-library-read playlist-read-private playlist-read-collaborative
  user-top-read user-read-recently-played`.
- `GET /api/spotify/callback` checks `state` against the cookie and the
  signed-in user, exchanges the code, calls `GET /me`, and upserts
  `spotify_connections`. It then runs the first sync for that user with
  `after()` and redirects to `/library?spotify=connected`.
- **A Spotify account not added in the dashboard** fails at `GET /me` with a
  403. The callback shows: "Spotify hasn't approved this account for june yet —
  ask Jacob to add it." It stores nothing.
- A Spotify account already linked to another june user is refused by the
  unique constraint and shown as such.

Redirect URIs, registered in the dashboard:

- `https://june-jam.vercel.app/api/spotify/callback`
- `http://127.0.0.1:3000/api/spotify/callback`. Spotify rejects `localhost`, so
  local development of this feature runs on `127.0.0.1`.

New env vars (server-only): `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`,
`SPOTIFY_SYNC_SECRET`, `MP3SERVER_SERVICE_TOKEN`.

## Syncing

**Trigger.** pg_cron runs every 30 minutes and calls
`net.http_post('https://june-jam.vercel.app/api/spotify/sync')` with
`Authorization: Bearer <secret>`. The secret is read from Vault inside the cron
SQL. The route compares it with `SPOTIFY_SYNC_SECRET` in constant time.

A **"Sync now"** server action on `/library` syncs just the caller. It is
refused if that user synced less than a minute ago.

**Lease.** Both paths call `claim_spotify_sync` first. If a run holds the lease
the call returns "a sync is already running", which matters during a long first
sync. The lease expires on its own after 5 minutes so a crashed run cannot hold
it forever.

**Per user**, one at a time:

1. **Token.** Refresh when it expires within 60 seconds. Save the new refresh
   token if Spotify returns one. `invalid_grant` sets `status = 'revoked'`, and
   `/library` asks the user to reconnect.
2. **Recent listens.** `GET /me/player/recently-played?limit=50&after=<cursor>`.
   Upsert songs, insert `listens` (conflicts ignored), move the cursor to the
   newest `played_at`. **Spotify keeps only the last 50 plays.** If 50 come back
   and the oldest is newer than the old cursor, plays in between were lost; the
   run logs the window. At 30-minute intervals that means more than 50 plays in
   half an hour, which should be rare.
3. **Liked songs.** `GET /me/tracks?limit=50`, newest first, stopping at the
   first `added_at` already stored. When `last_daily_sync_at` is over 24 hours
   old, page through everything instead and delete `library_songs` rows that
   no longer appear (unliked songs).
4. **Playlists.** Page `GET /me/playlists`. Keep only playlists the user owns
   or collaborates on. For each whose `snapshot_id` changed, page
   `GET /playlists/{id}/items` and replace its `playlist_songs` in one
   transaction. Local files and episodes are skipped. Delete stored playlists
   that no longer appear.
5. **Taste** (daily, with the full liked pass). `GET /me/top/artists` and
   `/me/top/tracks`, limit 50, for all three time ranges, into
   `taste_snapshots`.
6. Every track seen in steps 2–5 is upserted into `songs`. New songs start at
   `match_state = 'pending'`.

**After all users:** run matching (phase 2) and send the keep list (phase 3).
Both need mp3server; if it can't be reached, the Spotify data is already
saved, and the error is logged and recorded for the run.

**Failures.** A failing user gets `last_error` and `last_error_at`, the error is
logged with `console.error`, `/library` shows it, and the run continues with
the next user. **A 429 ends the run for everyone**, since quota is shared across
the developer account; the next tick retries. Nothing is swallowed: every
caught error is recorded where the user will see it.

**Budget.** About 20–30 Spotify calls per run for five users. A first sync of
2,000 liked songs and 50 playlists is about 150 calls, well inside one
function's 300 seconds.

## Matching (phase 2)

### mp3server changes

- **Service token.** `SERVICE_TOKEN` in mp3server's `.env` (june holds the same
  value as `MP3SERVER_SERVICE_TOKEN`) is accepted as
  `Authorization: Bearer <token>` on `/imports`, `/match` and `/pins` only,
  compared in constant time, and resolves to a fixed service principal.
  Every other route still requires a Supabase JWT.
- **`matched_duration_ms`.** A new `import_tracks` column (migration `0005`),
  filled from the chosen candidate's `duration_seconds`, and returned in
  `TrackState`. A norm_key cache hit whose row has no duration counts as a
  miss and is searched again, so old rows fill in over time rather than
  handing june a match it can't time.
- **Rate limit.** The resolver searches one at a time, at least 3 seconds apart
  (`resolve_min_interval_s`, about 20 a minute). Cache hits don't wait.
  Matching whole libraries is the first bulk YouTube traffic from the home IP.
  User-driven imports (#85) share this limit, so a 100-track import takes about
  five minutes.
- **`POST /match`** takes one `{title, artist, duration_ms}` and returns
  `{state, video_id, matched_title, confidence, matched_duration_ms}` inline. It
  uses the same search, `pick_candidate` and norm_key cache as an import child,
  but runs in the API process (`asyncio.to_thread`), so it never waits behind a
  queued batch.

### Background matching (june, end of each sync run)

1. **Collect.** For each distinct `match_job_id` among songs in `matching`,
   `GET /imports/{id}`. Results come back in submission order
   (`ImportTrack.position`), and each song's `match_position` was saved when
   the batch was sent, so results are joined on it. Write `video_id`,
   `video_duration_ms`, `match_confidence`, `matched_at` and the final state.
   mp3server's `resolved` maps to `matched`; `not_found` and `failed` map
   across; `canceled` returns the song to `pending`. Anything still pending
   waits for the next run.
2. **Submit.** Take up to 500 `pending` songs, oldest first, and `POST /imports`
   with `title`, `artists[1]` and Spotify's `duration_ms`. Mark them `matching`
   with the returned job id and their index in the request as
   `match_position`.

A 2,000-song library is matched a few hours after connecting. Songs anyone has
matched before come back from mp3server's norm_key cache without a search.

## Playing in rooms (phase 2)

**Refactor first.** `app/room/[code]/add-music.tsx` (406 lines, two tabs, two
drill-down views) becomes a shell plus one component per tab. #85 and #87 need
the same split.

**Library tab.** Two views: Liked (with a filter box) and Playlists (open one to
see its songs). `/library` renders the same list components. Each row shows its
state:

| State | Row |
| --- | --- |
| matched, high | Add |
| matched, low | Add, marked "?" |
| pending / matching | spinner; clicking matches it now |
| not_found / failed | greyed out, still listed |

**`queueLibrarySong(roomId, songId)`**, a server action:

- If the song is matched, call the existing `enqueueTrack` with Spotify's title,
  artists and artwork, the `video_id`, and `video_duration_ms`. The room clock
  ends a track on the audio's length, not Spotify's; a few seconds' difference
  would cut the end off or leave silence. No YouTube Data API call is made.
- If not, call `POST /match` (service token, 20-second timeout), save the
  result, then queue it or return "no match found".

**`queueLibraryPlaylist(roomId, playlistId)`** queues the matched songs in
order and returns counts: "Added 38 · 3 still matching · 1 not found". It never
drops a song without saying so.

## Keeping audio at home (phase 3)

### The keep list

At the end of each sync, june sends `PUT /pins` with the full result of
`library_video_ids()` (service token). mp3server replaces its `pins` table
(`video_id` primary key, `pinned_at`; migration `0006`) in one transaction.
Sending the whole set each time means a missed run corrects itself on the next.
Ten thousand ids is about 130 KB.

### Eviction

`expire_cache` (7-day idle TTL) and `evict_cache` (disk pressure) skip files
whose `video_id` is pinned. When a song leaves every library its pin goes with
the next `PUT`, and normal eviction applies again.

### Slow downloads

A new arq cron job, `prefetch_pins`, runs every few minutes and starts at most
one download, only when all of these hold:

- no download job is queued or running (a room waiting on audio always wins)
- fewer than `pin_downloads_per_hour` (default 12) prefetches started in the
  last hour. 2,000 songs takes about a week
- free disk is above `pin_reserve_free_mb` (default 10240), so room playback
  always has space
- prefetch isn't paused

It picks a pinned `video_id` with no stored file and no failed download job
in the last 24 hours.

**Bot-check pause.** The first time a prefetch download fails with YouTube's
"confirm you're not a bot" error, prefetching pauses for 6 hours
(`pin_pause_hours`) and the worker logs it at error level. Room downloads are
not paused. If the home IP gets flagged, all playback breaks, so the background
job backs off first.

Anything queued in a room still downloads immediately, as today, and is kept
afterwards if pinned.

### Disk

About 4 MB per track. Five libraries of about 2,000 songs each, after overlap,
is roughly 30–40 GB. Grow the VM disk from 40 GB to about 100 GB (Proxmox
`qm resize`, then `growpart` and `resize2fs` in the guest). `local-lvm` has
about 800 GB free.

## Error handling

- Spotify errors: per user, in `last_error`, shown on `/library`, logged.
- Revoked access: `status = 'revoked'`, and a reconnect prompt.
- Account not added in the dashboard: its own message at connect time.
- 429: ends the run, next tick retries.
- mp3server unreachable: Spotify data still saved; matching and the keep list
  wait for the next run; logged and recorded.
- Overlapping runs: the lease.
- Unmatched, not-found and failed songs stay visible with their state.
- `/match` timeout: the row says so, and the song stays `pending` for the
  background.

## Testing

TDD for everything that needs no IO. Fixtures are recorded Spotify response
shapes, used in tests only.

**june (Vitest)**

- Zod schemas for every Spotify response used, including missing optional
  fields.
- Track → `songs` row: several artists, no album art, `is_local` tracks and
  episodes skipped.
- Liked-songs diff: stops at the first stored `added_at`; the daily pass finds
  unliked songs.
- Playlist diff: changed `snapshot_id` is re-read, unchanged is not, missing
  playlists are deleted, followed playlists owned by others are ignored.
- Recent-plays cursor: advances to the newest `played_at`; gap detection when
  50 come back.
- Token refresh decision around the 60-second margin.
- Import results → song updates, including position alignment and every state.
- Playlist queue summary counts.
- The `state` check in the callback.

**mp3server (pytest)**

- The service token is accepted on `/imports`, `/match` and `/pins`, and
  rejected everywhere else.
- `matched_duration_ms` is stored and returned; a cache hit without one
  re-searches.
- Resolver spacing: searches at least `resolve_min_interval_s` apart; cache
  hits don't wait.
- `/match` returns inline and uses the norm_key cache.
- `PUT /pins` replaces the set.
- `expire_cache` and `evict_cache` both skip pinned files.
- `prefetch_pins`: respects the hourly cap, the disk reserve, "no download
  queued or running", and the pause; the bot-check error starts the pause.

**By hand**

- Connect your own account on `127.0.0.1`; `/library` fills in.
- Like a song on your phone, press Sync now, see it arrive.
- Play something on Spotify, see it in listens after the next sync.
- Queue a liked song in a room open in two browsers; both play it in sync, and
  it ends when the audio ends.
- Unlike a song, force the daily pass, see it removed.
- A friend's account not in the dashboard gets the specific message.
- A pinned track is still on disk after the TTL (use a short
  `CACHE_TTL_HOURS` on a local box).

## Setup

- **Spotify dashboard:** create the app under the Premium account, add both
  redirect URIs, and add each friend's Spotify email. The five-user limit most
  likely includes the owner.
- **Vercel:** the four new env vars.
- **Supabase:** enable `pg_net`; store the sync secret in Vault; schedule the
  cron job (migration).
- **mp3server:** `SERVICE_TOKEN` in `.env`; `alembic upgrade head` for `0005`
  and `0006`; grow the disk.
- **Docs:** `docs/ARCHITECTURE.md` gains the Spotify flow and the new
  june → mp3server path.

## Files

| Area | Files |
| --- | --- |
| Migrations | `supabase/migrations/20260925000000_spotify_library.sql` (tables, RLS, functions, lease), `20260925000100_spotify_sync_cron.sql` |
| Spotify boundary | new `src/spotify/schema.ts`, `client.ts`, `map.ts`, `diff.ts` |
| Sync | new `src/lib/spotify/connection.ts`, `sync.ts`, `matching.ts`, `pins.ts` |
| mp3server client | `src/audio/` gains a server-side service client for `/imports`, `/match`, `/pins` |
| Routes | new `app/api/spotify/connect/route.ts`, `callback/route.ts`, `sync/route.ts` |
| Library UI | new `app/library/page.tsx` and shared list components |
| Room UI | `app/room/[code]/add-music.tsx` split into per-tab components, plus the Library tab |
| Room actions | `src/lib/room/library.ts` (`queueLibrarySong`, `queueLibraryPlaylist`) |
| mp3server | `auth.py` (service principal), `routes/imports.py`, new `routes/match.py`, new `routes/pins.py`, `matching.py`, `worker.py` (spacing, pin-aware eviction, `prefetch_pins`), `models.py`, migrations `0005`, `0006`, `config.py` |
| Tests | `test/spotify/*.test.ts`, `test/lib/spotify-*.test.ts`; mp3server `test_auth.py`, `test_api_match.py`, `test_api_pins.py`, `test_worker_prefetch.py`, and additions to `test_worker_evict.py`, `test_worker_resolve.py` |

## Risks

- **Match quality is the feature.** Low-confidence matches are marked, not
  hidden; a confident wrong match is worse than a reported miss.
- **Bulk YouTube traffic from the home IP.** Matching is rate-limited and
  prefetch pauses on the first bot check. If the IP is flagged anyway,
  playback for everyone breaks until it clears.
- **Spotify can change Development Mode again.** It did in February and July
  2026. The sync is small and isolated in `src/spotify/` so a change touches
  one place.
- **A permanent copy.** The homelab becomes a lasting collection of the
  recordings, not a short-lived cache. It stays behind the invited-user auth
  and is never exposed beyond it.

## Follow-ups

- Re-match a song when its video is taken down (a download that fails as
  unavailable sets `match_state = 'failed'` and re-queues matching).
- The Spotify export zip as a source: full history, no user cap.
- Show a library to friends.
