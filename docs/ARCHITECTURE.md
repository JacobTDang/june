# june — architecture & onboarding

A jam room for music: friends join a room by code and hear the same song at the
same second, each in their own browser. This document is what a new contributor
needs to understand the system, run it, and operate it.

## The one-paragraph version

june is a Next.js app on Vercel backed by Supabase (Postgres + Auth + Realtime).
It never uploads or hosts music itself; instead a companion service —
**mp3server**, a FastAPI app on an Oracle Cloud box — downloads a track's audio
once with `yt_dlp` and serves it as a file. Every listener's browser plays a
plain `<audio>` element pointed at that file, and each browser seeks itself to
`serverNow − startedAt`. The server coordinates *what* is playing and *when it
started*; nothing streams through june.

## Repositories

| Repo | What it is | Where it runs |
| --- | --- | --- |
| `june` (this one) | Next.js 16 app: rooms, queue, search, playback UI | Vercel, auto-deploys from `main` |
| `mp3server` | FastAPI + arq worker: downloads and serves audio | Oracle Cloud ARM box, Docker Compose |

They are deployed independently. june talks to mp3server **from the browser**,
not server-to-server.

## Request flow: what happens when someone adds a song

1. **Discovery** (server action) — the user searches; results come from the
   iTunes Search API (zero YouTube quota). Picking one resolves it to a YouTube
   `videoId` via one `search.list` call, cached forever in `track_resolution`.
2. **Queue** — a row lands in `queue_items`. If the room is idle the track is
   promoted to now-playing on the `rooms` row with **`now_playing_started_at =
   NULL`** — "on deck, clock not started".
3. **Prepare** — each listener's player asks mp3server for a signed stream URL by
   videoId. On a miss it posts to `/downloads` (idempotent) and polls. Players
   also pre-download the next two queued tracks.
4. **Start** — the first player to confirm the file exists calls `markTrackReady`,
   a compare-and-set that stamps `started_at` exactly once no matter how many
   clients race. Supabase Realtime broadcasts the change.
5. **Play** — every player mints its own signed URL, sets `<audio src>`, and seeks
   to the shared position. Everyone starts at 0:00 together.
6. **Advance** — on `ended` (or drift past duration, or a 90-second preparing
   timeout) any client calls `advanceTrack`, whose compare-and-set means the room
   advances once even if all clients fire at the same moment.

## june internals

```
app/room/[code]/
  room.tsx           room shell: realtime subscription, queue drag-reorder, presence
  player.tsx         the <audio> element, load/retry loop, drift correction
  pixel-visualizer.tsx   canvas dot-matrix driven by real audio frequencies
  now-playing.tsx    title/artist/progress + skip
  add-music.tsx      search, paste-link, playlist import UI
src/
  jam/          pure, tested core: FIFO queue, clock offset estimation
  lib/room/     room state: actions.ts (server actions), types.ts (row mappers),
                sync.ts (playbackCorrection), progress.ts
  audio/        mp3server client: client.ts, schema.ts, preparing.ts, spectrum.ts
  youtube/      YouTube Data API layer (Zod-validated)
  discovery/    iTunes search + ranking
```

**Design rule the codebase follows:** anything decidable without IO lives in a
pure module with tests (`src/jam`, `src/lib/room/sync.ts`, `src/audio/spectrum.ts`);
React components stay thin. `now` is always a parameter, never `Date.now()` inside
the logic — that's what makes the sync math testable.

### The player's state machine

The loader effect re-runs when the track changes *or* when its clock starts
(`trackKey` folds both in). Per iteration:

- mint a stream link by videoId
- **404** → ensure a download exists, wait, poll again
- **track pending** (`startedAt === null`) → call `markTrackReady`, then wait for
  the realtime flip
- **ready** → set `src`, seek at `loadedmetadata`, play

Every wait is bounded: 90 seconds without becoming playable and the client calls
`advanceTrack`, so a track that can't download never freezes the room. A signed
link that expires mid-play is re-minted exactly once; a second failure advances.

Two subtleties worth not breaking:

- **Seeking before metadata aborts the media fetch.** The drift loop skips
  correction until `readyState >= HAVE_METADATA`, and the initial seek waits for
  `loadedmetadata`. Without this, loads livelock forever.
- **The unlock clip.** A zero-length silent WAV is played inside the tap gesture
  so iOS marks the element user-activated. `onEnded`/`onError` ignore it via a
  `data:` check — otherwise it instantly "ends" the room's track.

### Lyrics

Lines come from the video's own caption track when it has one — those are timed
against the exact upload we stream — and from LRCLIB otherwise. That distinction
matters: transcriptions of one song disagree by whole intros (16s versus 31s for
the same recording length), and no metadata says which fits a given upload.
Position comes from the playing element's `currentTime`, not the room clock,
because the player tolerates ~1.2s of drift before correcting. Word positions
within a line are interpolated; LRC and caption tracks both time whole lines
only, so anything finer would be a guess.

### The visualizer

`captureStream()` on the audio element feeds an `AnalyserNode`; `spectrumColumns`
folds FFT bins into log-spaced columns that light the dot grid. This is a **copy
of the signal, not a reroute** — `createMediaElementSource` would route playback
*through* an AudioContext, and a suspended context (phone backgrounding) would
then silence the music. Browsers without `captureStream` (Safari) get a shimmer
and unaffected audio. If you touch this file, keep that invariant.

## mp3server internals

```
src/mp3server/
  main.py       app factory, CORS
  auth.py       verifies june's Supabase JWTs (ES256 via JWKS)
  routes/       downloads.py (job API), files.py (list/link/stream), health.py
  worker.py     arq worker: yt_dlp download, dedup, LRU eviction
  ytdl.py       yt_dlp configuration
  links.py      HMAC-signed short-lived stream URLs
  models.py     jobs, files
```

**Auth model.** Users authenticate to *june* with Google via Supabase. mp3server
verifies those same tokens — one identity system, no separate login. Any invited
user may mint a link for any stored track, deliberately: listeners must be able to
play a track someone else queued, and the server has no concept of rooms.

**Why signed URLs.** An `<audio>` element cannot send an `Authorization` header,
so playback uses a short-lived HMAC-signed URL (`?exp=…&sig=…`) instead. Both
`/download` (bearer) and `/stream` (signature) support HTTP Range, so seeking
works without refetching.

**Storage.** Audio is AAC in `.m4a`, remuxed rather than re-encoded (no transcode
cost). Objects are content-addressed by videoId and **shared between users** —
the second person to queue a song gets it instantly. Least-recently-played
eviction runs when disk gets tight.

## Data model (Supabase)

- `rooms` — one row per room: code, and the now-playing projection
  (`now_playing_video_id`, `_title`, `_artist`, `_duration_ms`,
  `_thumbnail_url`, `_started_at`, `_added_by_name`). `_started_at` NULL means
  pending.
- `queue_items` — FIFO with a `position` column for drag-reorder. Rows are
  **deleted when a track starts playing** — the queue is not a history.
- `room_participants` — presence, one room per user (unique on `user_id`).
- `room_messages` — chat. Readable and writable only by room participants,
  append-only, and cascade-deleted with the room.
- `plays` — the one table that outlives a room: one row per listener per track,
  written server-side when a track ends, with `skipped` and `listened_ms`.
  Readable by you and by anyone who was in that room with you; writes are
  service-role only, so a history can't be forged.
- `track_resolution`, `video_cache`, `lyrics_cache` — service-role caches keyed
  by track, shared across everyone.
- Plus profiles (name, `@username`, bio, avatar), friendships, signup cap.

Access is Row-Level Security + `SECURITY DEFINER` RPCs; `pg_cron` sweeps dead
rooms.

**Two gotchas worth knowing before you debug either.**

*Realtime must be authorized before it subscribes.* `supabase.realtime.setAuth()`
has to run before `.subscribe()`, and refreshed tokens must be handed to it via
`onAuthStateChange`. Subscribing first opens the socket as anonymous, RLS then
hides every row it is watching, and nothing errors — the symptom is a feature
that only updates when you reload. Both the room channel and chat do this.

*Storage can't verify this project's JWTs.* Auth issues **ES256** tokens.
Postgres (via PostgREST) verifies them, but Supabase Storage does not, so an
authenticated upload arrives as anonymous and is refused by the bucket policy.
Avatar uploads therefore write with the service role from a server action, where
the user is already verified and the object path is built from their id. The
bucket policies stay in place for direct client writes.

## Environments and secrets

**june (Vercel — `junejam` account, project `june`, prod `june-jam.vercel.app`)**

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | Supabase client |
| `NEXT_PUBLIC_MP3SERVER_URL` | `https://june-audio.duckdns.org` |
| `YOUTUBE_API_KEY` | search/metadata |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only cache writes |

`NEXT_PUBLIC_*` values are **baked in at build time** — changing one requires a
redeploy, not just a save.

**mp3server (`~/mp3server/.env` on the box, never committed)**

`DATABASE_URL`, `SUPABASE_URL` (june's project, for token verification),
`CORS_ALLOW_ORIGINS`, `DOWNLOAD_LINK_SECRET`, `COOKIES_FILE`, plus limits
(`MAX_PARALLEL_JOBS`, `MAX_DURATION_SECONDS`, `CACHE_TTL_HOURS`, …). See
`.env.example`.

**CORS is a real trap:** the browser calls mp3server directly, so every origin
that serves june must be in `CORS_ALLOW_ORIGINS`. A missing origin looks exactly
like "server is down" in the UI.

## Running locally

```bash
# audio server
cd mp3server
cp .env.example .env          # fill in; use a local Postgres via an override file
docker compose up -d
docker compose run --rm api alembic upgrade head

# app
cd june
npm install
echo 'NEXT_PUBLIC_MP3SERVER_URL=http://localhost:8000' >> .env.local
npm run dev
```

Tests: `npm test` (Vitest, ~295) and `npx tsc --noEmit` in june;
`.venv/bin/pytest` (~174) in mp3server. Network-touching tests are opt-in:
`pytest -m network`.

## Production topology

```
phone/laptop ──HTTPS──> june-jam.vercel.app        (Next.js, Vercel)
      │                        │
      │                        └── Supabase: Postgres, Auth, Realtime
      │
      └────HTTPS────> june-audio.duckdns.org       (Oracle A1, 2 OCPU / 12 GB)
                             │
                    Caddy ──> api ──> Postgres
                              worker ──> yt_dlp ──> YouTube
                              redis (job queue)
```

The box runs `docker compose --profile prod up -d` (adds Caddy for TLS; plain
`up` is local dev). DNS is DuckDNS. Firewall: 22/80/443 only. Cost is $0 inside
Always Free; a $5 budget alert is configured as a tripwire.

## Operations runbook

**Deploy june** — merge to `main`; Vercel builds automatically.

**Deploy mp3server**
```bash
ssh ubuntu@<box-ip>
cd mp3server && git pull
sudo docker compose --profile prod up -d --build
sudo docker compose run --rm api alembic upgrade head   # if migrations changed
```

**Check health**
```bash
curl https://june-audio.duckdns.org/readyz     # names whichever dependency is down
sudo docker compose ps
sudo docker compose logs worker --since 10m
```

**"Sign in to confirm you're not a bot" in worker logs** — the YouTube cookie
session expired. Re-export from a signed-in browser (Netscape format; filter to
`youtube.com` lines only), copy to `~/mp3server/cookies.txt`, `chown 10001:10001`
so the container user can read *and write* it (yt_dlp refreshes it in place), then
restart the worker. One export covers all users — never collect cookies from
listeners.

**"Requested format is not available"** — yt_dlp couldn't solve YouTube's JS
challenge. Needs Deno in the image *and* `remote_components: {"ejs:github"}` in
`ytdl.py`. Both are configured; this error means one regressed.

**Rooms say "Can't reach the audio server"** — check `/readyz`, then check that
the browser's origin is in `CORS_ALLOW_ORIGINS`.

**Rooms say "Audio server isn't configured"** — `NEXT_PUBLIC_MP3SERVER_URL` is
missing from the Vercel build. Set it and redeploy.

## Conventions

- TDD for logic that can be tested without IO; the pure modules exist for this.
- Fail loud — no swallowed errors, no silent fallbacks. Where a best-effort path
  is deliberate (prefetch, the unlock clip), a comment says why and what surfaces
  the failure instead.
- Comments explain constraints the code can't show ("seeking before metadata
  aborts the fetch"), not what the next line does.
- Ask before adding a dependency.

## Known follow-ups

Tracked in issue #44 — lock-screen state re-sync, prefetch backoff, an instance
discriminator so duplicate pending copies of the same video can't double-advance,
and assorted copy fixes. None affect correctness of playback today.
