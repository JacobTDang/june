# mp3server audio playback

Replace room playback's YouTube IFrame with `<audio>` streams served by
mp3server (the self-hosted yt_dlp download service in the sibling
`mp3server` repo). Discovery, resolution, queueing, and sync semantics are
unchanged — only how the sound reaches the browser changes.

## Why

The YouTube IFrame is the cause of june's two worst playback problems:

- **Mobile background audio** — the IFrame stops when the phone locks or the
  tab backgrounds. A real `<audio>` element keeps playing, and the Media
  Session API puts track metadata and controls on the lock screen.
- **Filtered networks** — café/office WiFi that blocks youtube.com blanks the
  player. Audio served from our own box is unaffected.

## Decisions

1. **Full replacement.** Rooms play `<audio>` from mp3server; the YouTube
   IFrame and its API script are removed from the room page. YouTube Data
   API / iTunes search remain for discovery and playlist import.
2. **Shared Supabase auth.** mp3server is reconfigured to verify june's
   Supabase project tokens. The browser calls mp3server directly with the
   user's existing session token. `CORS_ALLOW_ORIGINS` lists june's dev and
   prod origins. `ALLOWED_USER_IDS` stays empty — june's signup cap bounds
   the user base.
3. **Deployed as part of this work.** Oracle Always Free A1 instance running
   the existing docker-compose stack (api, worker, redis) behind Caddy for
   TLS on a subdomain, browser cookies.txt mounted for YouTube bot-detection.
4. **Resolution by videoId.** mp3server gains one endpoint that mints a
   stream link from a videoId, so any participant can resolve the room's
   current track without knowing who downloaded it.

## Architecture

```
add track:  june UI → queue_items insert (unchanged)
            → best-effort POST {MP3}/downloads {url} from the client

play:       player → POST {MP3}/files/by-video/{videoId}/link
            → <audio src="{MP3}{signed url}"> seeked to the shared clock

not ready:  "Preparing…" → POST {MP3}/downloads (idempotent; cached videos
            complete near-instantly) → re-poll the link endpoint every ~3s
```

The queue-time download is an optimization; the play-time self-heal is the
guarantee. Any participant can trigger and resolve — nothing depends on the
queuer's tab staying open.

## mp3server changes (sibling repo, TDD)

- **New endpoint** `POST /files/by-video/{video_id}/link` — bearer-
  authenticated, same signed-URL semantics as `POST /files/{id}/link`
  (any invited user may mint a link for any stored track), 404 when no file
  row exists for that videoId. Multiple users may each have a row for the
  same video (they share one storage object); return a link for the
  newest row.
- **Everything else is configuration:** june's Supabase project for token
  verification, `CORS_ALLOW_ORIGINS`, empty `ALLOWED_USER_IDS`,
  `DOWNLOAD_LINK_SECRET`. The link TTL default (1 hour) already exceeds any
  track length.

## june changes

- **`src/audio/`** — mp3server client module in the style of
  `src/youtube/`: fetch-injected, Zod-validated responses, no IO in tests.
  Operations: `mintLinkByVideoId`, `ensureDownload`. Base URL from
  `NEXT_PUBLIC_MP3SERVER_URL`; bearer token from the browser Supabase
  client's session.
- **`app/room/[code]/player.tsx` rewrite** — all YT IFrame machinery
  removed. An `<audio>` element driven by the existing pure sync logic:
  `playbackCorrection` on a 2s interval for drift, `onended` (or failure)
  → `advanceTrack`, tap-to-listen gate retained for autoplay policy. The
  16:9 video box becomes a compact status card (Tap to listen /
  Preparing… / error); `NowPlaying` already shows title, artist, and
  progress.
- **Player-driven prefetch.** The add paths all run in server actions, so
  the prefetch hook lives where the browser session token already is: the
  room player best-effort `ensureDownload`s the next two queued tracks.
  One code path covers every add route, including bulk playlist import,
  and nothing depends on the adder's tab. A 429 from mp3server's per-user
  pending cap is tolerated because the play-time self-heal covers any
  track that missed prefetch.
- **Media Session API** — title/artist/artwork metadata so the lock screen
  shows the track while backgrounded.
- The "network is blocking YouTube" error UI is removed along with the
  IFrame.

## Error handling

- **Track never becomes ready** (failed job, region-blocked, over the
  duration cap): after 90 seconds of "Preparing", call `advanceTrack` and
  show "couldn't prepare this track — skipped". All clients converge, same
  as today's ENDED path. The timeout policy is a pure function.
- **Signed link expires or `<audio>` errors mid-play:** re-mint once and
  restore position from the shared clock; a second failure advances. No
  silent retry loops.
- **mp3server unreachable:** visible error state with periodic retry. Room
  state keeps advancing on the shared clock, so playback rejoins in sync
  when the server returns.

## Deployment

- Oracle Always Free A1 (arm64), Docker installed, repo cloned, `.env`
  filled with june's Supabase settings, alembic migrated.
- Caddy in front for TLS on a subdomain pointed at the instance (operator
  supplies the DNS record; Caddy auto-provisions the certificate).
- `cookies.txt` exported from a browser and mounted into the worker to get
  past datacenter-IP bot checks.
- Vercel env: `NEXT_PUBLIC_MP3SERVER_URL=https://<subdomain>`.

## Testing

- **mp3server (pytest):** by-video endpoint — 404 when absent, mints for a
  file another user downloaded, picks the newest row when several exist.
- **june (Vitest):** `src/audio/` client parsing and error paths; the
  preparing-timeout policy as pure logic alongside the existing sync tests.
- **Manual:** two browsers in one room stay in sync locally; phone
  lock-screen playback continues with Media Session metadata; deployed
  instance smoke test (queue → prepare → play over HTTPS).
