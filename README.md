# june

A jam room for music. Friends join by code and hear the same queue **in sync**,
each on their own device: laptop, phone, screen on or off.

![june: a room playing in sync on a laptop and a phone, searching and queueing songs, and bringing in a Spotify library](docs/media/june-demo.gif)

## How it works

A self-hosted audio server (`mp3server`, a sibling repo) fetches each track once
and streams it back over signed, expiring URLs. Each browser plays that stream
in a plain `<audio>` element. june's database only coordinates *what* is playing
and *when it started*: everyone computes their position as
`serverNow − startedAt` and converges.

```
Discovery      iTunes Search API → resolve to a YouTube videoId once → cached forever
Audio          mp3server fetches the track, stores it, streams it back (HTTP Range)
Room state     Supabase Postgres + Realtime (rooms, queue, participants, chat)
Playback       each browser's <audio>, seeked to the shared clock
```

Playing real audio instead of an embedded player is what lets it keep going on
a phone with the screen off, and on networks that block YouTube.

## Features

- **Synced playback.** The same song at the same second, in every browser in the room.
- **Per-device sound.** Mute or set the volume on *this* screen, so a laptop and a
  phone can both be in the jam without doubling up.
- **Search as you type.** iTunes results with zero YouTube quota, ranked so the
  studio version wins, with a click-through artist view.
- **Queue.** A scrollable "up next" with drag-to-reorder, and suggestions from
  what the room has played once it runs dry.
- **Playlists.** Browse your own YouTube playlists, or paste any playlist link
  and pick tracks from it.
- **Spotify library.** Connect Spotify to bring in your liked songs, your own
  playlists, recent plays and top artists, synced every 30 minutes. Songs are
  matched to audio in the background, and the room's Library tab queues them.
  Spotify's Development Mode limits this to five accounts.
- **Lyrics (beta).** Line by line, timed from the video's own captions where they
  exist and a lyrics database otherwise.
- **Chat.** Realtime, in the room, alongside the queue.
- **Friends.** Requests with an in-room toast, and a friend's current jam with a
  button to join them.
- **Your listening.** Recently played and past jams on the home page, top artists
  on your profile.
- **Profiles.** Display name, `@username`, bio, avatar.

## Stack

- **Next.js 16** (App Router, Server Actions), **React 19**, **TypeScript**
- **Supabase**: Postgres, Auth (Google), RLS, `SECURITY DEFINER` functions,
  Realtime, Storage, `pg_cron`
- **mp3server**: FastAPI, arq and yt-dlp on a home server, published with
  Tailscale Funnel
- **iTunes Search API** for discovery, **YouTube Data API** for resolution and
  playlists, **Spotify Web API** for libraries
- **Vitest** for the pure logic
- **Vercel** for hosting

## Layout

- **`src/jam/`**: the pure core (queue, sync clock, clock-offset estimation). No
  IO; `now` is always a parameter.
- **`src/audio/`**: mp3server clients (browser downloads, and the server-side
  import and match calls), download progress, visualizer math.
- **`src/spotify/`** · **`src/lib/spotify/`**: the Spotify API boundary, and the
  library sync and matching.
- **`src/discovery/`** · **`src/youtube/`**: iTunes search and ranking, and the
  YouTube API layer, validated with Zod at the boundary.
- **`src/lyrics/`**: LRC parsing, caption conversion, lyrics matching.
- **`src/lib/`**: Supabase clients, room actions, plays, friends, profiles.
- **`app/`**: the App Router UI (home, room, library, friends, profile).
- **`supabase/migrations/`**: schema, RLS and functions.

How the pieces fit together, the invariants that aren't obvious from the code,
and the operations runbook are in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Local development

```bash
npm install
cp .env.local.example .env.local   # fill in the values
npm run dev                        # http://127.0.0.1:3000
```

Use `127.0.0.1` rather than `localhost`: Spotify only accepts loopback IP
redirect URIs.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client (public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-side writes that bypass RLS (secret) |
| `NEXT_PUBLIC_MP3SERVER_URL` | The audio server |
| `MP3SERVER_SERVICE_TOKEN` | june's server → mp3server, for library matching (same value as its `SERVICE_TOKEN`) |
| `YOUTUBE_API_KEY` | YouTube Data API |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Refresh the YouTube token |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | The Spotify Development Mode app (five users) |
| `SPOTIFY_SYNC_SECRET` | Bearer secret for the cron-driven Spotify sync |
| `ADMIN_EMAIL` | Owner email for `/metrics` |
| `SIGNUP_CAP` | Optional seat cap (defaults to 20) |

Sign-in needs the Supabase Google provider and a Google OAuth client whose
redirect URI is your Supabase `/auth/v1/callback`. Running the audio server
locally is covered in the architecture doc.

## Testing

```bash
npm test          # the pure logic: sync clock, queue, matching, lyrics, discovery…
npm run typecheck
npm run build
```

Sync, realtime and playback are integration behaviour. Check them by opening a
room in **two browsers** and confirming both play the same track at the same
position.

## Deploy

- **The app:** Vercel. Set the env vars above in Vercel.
- **Supabase:** add `https://<your-domain>/**` as a redirect URL.
- **Google:** publish the OAuth consent screen, so YouTube refresh tokens don't expire after 7 days.
- **The audio server:** any machine with disk. The architecture doc has the runbook.
