# june

A jam room for YouTube Music — friends join a room by code and listen to the
same queue, **in sync**, each in their own browser.

## How it works

june never touches the audio. Each participant's browser plays the video
through YouTube's own **IFrame player**; the server only coordinates *what* is
playing and *when it started*. Everyone computes their position as
`serverNow − startedAt` and converges — no audio ever flows through june.

```
Discovery (0 YouTube quota)   iTunes Search API  →  resolve to a videoId once  →  cached forever
Add music                      paste link (1 unit) · search · import playlist (cheap)
Room state                     Supabase Postgres + Realtime (rooms, queue_items, room_participants)
Playback                       each browser's YouTube IFrame player, seeked to the shared clock
```

## Architecture

- **`src/jam/`** — the pure, tested core: FIFO queue, sync clock, NTP-style
  clock-offset estimation. No IO, deterministic (`now` is a parameter).
- **`src/youtube/`** — YouTube Data API layer: parsing, fetch-injected client,
  playlist import. Anti-corruption boundary with Zod validation.
- **`src/discovery/`** — iTunes Search API client (zero-quota discovery).
- **`src/lib/`** — Supabase auth, the video-metadata cache, and the room
  (schema types, server actions, add-music).
- **`app/`** — Next.js App Router UI (auth, lobby, room, synced player).

## Local development

```bash
npm install
cp .env.local.example .env.local   # fill in the three values
npm run dev                        # http://localhost:3000
```

`.env.local` needs: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`YOUTUBE_API_KEY`. Google sign-in also requires the Supabase Google provider +
a Google OAuth client (redirect URI = your Supabase `/auth/v1/callback`).

## Testing

```bash
npm test          # unit tests for the pure logic (jam core, youtube, cache, discovery)
npm run typecheck
npm run build
```

The realtime sync and IFrame playback are integration behavior — verify them by
opening a room in **two browsers** and confirming they play the same track at
the same position.

## Deploy (Vercel)

1. Push to GitHub, import the repo in Vercel.
2. Set the three env vars in Vercel project settings.
3. In Supabase → Authentication → URL Configuration: set the Site URL and add a
   `https://<your-domain>/**` redirect URL.
4. The Google OAuth redirect URI stays the Supabase callback (unchanged).

Runs on free tiers (Vercel Hobby + Supabase Free). Going public additionally
needs Google OAuth verification (the `youtube.readonly` scope is sensitive), a
privacy policy + terms, and — if you outgrow it — a YouTube quota increase.
