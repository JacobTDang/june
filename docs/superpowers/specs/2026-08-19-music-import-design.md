# Bringing your own music into june

**Goal:** a june user can pull in the music they already have — their YouTube
Music likes, and any playlist they can export from Spotify or elsewhere —
without june taking a dependency on a music service's API.

## Why not the Spotify API

The obvious design — OAuth into Spotify, browse playlists in june — is closed,
and it is worth recording why so nobody reopens it.

- **Playback is impossible.** The Web Playback SDK is Premium-only, DRM'd
  (`encrypted-media`), client-side only, and exposes no raw audio. mp3server can
  never hold a Spotify track, so Spotify audio cannot enter june's shared-stream
  model at all.
- **Synced group listening is prohibited.** Developer Policy III bars apps that
  play "content from a single source to several simultaneous listeners" (4), any
  product "integrated with streams or content from another service" (5), and
  letting a system "segue, mix, re-mix, or overlap any Spotify Content with any
  other audio content" (7). Those describe june exactly.
- **Access is capped below usefulness.** Since 11 Feb 2026 (existing apps 9 Mar),
  Dev Mode requires the *app owner* to hold Premium, allows one Client ID per
  developer, and permits five authorized users. Extended Quota requires a
  registered organisation with 250k monthly actives.

So june never talks to Spotify. Users export a playlist themselves — with
[Exportify](https://github.com/watsonbox/exportify), open source and browser-only,
using its own registration — and june imports the file.

**The load-bearing decision: june imports a _format_, not a service.** If
Exportify disappears, Spotlistr or `exportify-cli` emit the same columns and june
is unaffected.

## Why resolution belongs in mp3server

june resolves a song to a video with `search.list`, which costs **100 quota
units** against a 10,000/day default. A 100-track import would therefore spend
*the entire day's quota for the whole app* in one action, breaking search in
every room until midnight Pacific. Import is not viable on the Data API.

mp3server already holds yt-dlp with working cookies, and yt-dlp searches YouTube
by scraping rather than through the Data API — **no quota at all**. It also
already owns "find this audio and fetch it", runs an arq worker, and exposes a
job-and-poll interface (`/download`, `/downloads`) that june already knows how to
consume via `src/audio/downloads.ts`.

So resolution moves next to the thing that already does the same job, and import
becomes a *job* rather than a loop in a browser tab — which is also what makes it
robust.

This also removes iTunes from the import path entirely. An Exportify CSV already
carries `Track Name`, `Artist Name(s)`, `Track Duration (ms)` and
`Album Image URL`: **the file is the metadata**. mp3server only has to find
playable audio, and the CSV's duration is the check on whether it found the right
thing.

```
CSV  ─parse(june)─→  tracks ─POST /resolve─→  mp3server arq worker
                                                 ├ resolution cache hit → done
                                                 └ yt-dlp ytsearch + duration check
june polls /resolve/{job}  ←─ per-track: resolved | not_found | failed
```

## What june already has

`video_cache` holds video metadata, `track_resolution` caches song → videoId,
and `meteredFetch` meters Data API quota. Playlists, add-by-link and search
route through the existing iTunes → rank → videoId pipeline, which **stays
unchanged** — this spec adds a second, quota-free path used by import.

---

## Feature A — Liked songs

june asks for `youtube.readonly` at connect time, which already covers
`videos.list?myRating=like`. No new scope, no re-consent.

Liked items return **full video objects**, so they skip resolution entirely and
feed `video_cache` and the queue directly. `videos.list` costs 1 quota unit per
call of 50 items, so this is quota-trivial and stays in june.

**Client** — `src/youtube/client.ts` gains:

```ts
listLikedVideos(pageToken?: string): Promise<{ items: YouTubeVideoItem[]; nextPageToken?: string }>
```

`videos.list` with `myRating=like`, `part=snippet,contentDetails`,
`maxResults=50`, requiring auth.

**Action** — `src/lib/room/add-music.ts` gains `listLikedTracks(pageToken?)`
returning `YouTubeResult<{ tracks: VideoMeta[]; nextPageToken?: string }>`, the
same shape as `listMyPlaylists`.

**UI** — a "Liked" tab in `app/room/[code]/add-music.tsx` reusing the existing
track rows, with "Load more" driven by `nextPageToken`.

**Music-only default.** Liked videos include tutorials and talks. Rows filter to
`snippet.categoryId === "10"` (Music) by default, with a visible toggle — a
filter you cannot see looks like a bug when something is missing.

---

## Feature B — Track-list import

### Parsing (june, pure)

New `src/discovery/tracklist.ts`:

```ts
export interface ParsedTrack {
  title: string;
  artist: string;
  durationMs: number | null;
  artworkUrl: string | null;
}
export function parseTrackList(text: string): ParsedTrack[];
```

Accepts both shapes without being told which:

- **CSV with a header row**, as Exportify emits. Columns are located *by name*,
  never position, since Exportify's settings add optional columns: `Track Name`,
  `Artist Name(s)`, `Track Duration (ms)`, `Album Image URL`. `Artist Name(s)`
  may hold several comma-separated artists; the first is used for matching.
- **Plain lines** of `Artist - Title`, tolerating `-`, `–` and `—`.

Trims, drops blank and unparseable lines, de-duplicates on `(artist, title)`
case-insensitively.

### Resolution (mp3server)

A new endpoint pair mirroring `/download` and `/downloads`:

```
POST /resolve   { tracks: [{ title, artist, duration_ms }] }  → { job_id }
GET  /resolve/{job_id}  → { status, done, total,
                            results: [{ title, artist,
                                        state: "resolved"|"not_found"|"failed",
                                        video_id?, matched_title?, confidence?,
                                        error? }] }
```

The worker, per track:

1. **Cache first.** A `resolution` table keyed on normalized
   `(artist, title, duration_bucket)` short-circuits repeat work. Re-importing
   the same playlist costs nothing, and tracks shared across playlists resolve
   once.
2. **Search** with `yt-dlp` `ytsearch5:"<artist> <title>"`, metadata only — no
   download. Prefer results from an "- Topic" or `music.youtube.com` channel,
   which are the auto-generated official audio uploads.
3. **Verify by duration.** Where the CSV supplied one, take the candidate
   closest to it: within 3s is `resolved` with high confidence; 3–15s resolves
   with low confidence; beyond 15s is `not_found` rather than a wrong match.
   Without a duration, the first Topic-channel result wins, at low confidence.
   This is the entire defence against importing a live version, an extended
   edit, or a ten-hour loop.

**No audio is downloaded at import time.** Resolution stores an id; the bytes
arrive through june's existing prefetch when a track nears playback. Otherwise a
100-track import would fill the box's disk for music nobody may play.

### Review before queueing (june)

The import UI shows every parsed row against what it resolved to — artwork,
matched title, and its state — in three groups: matched, uncertain, not found.
Nothing is queued until the user confirms. Rows that found nothing stay visible
and are never silently dropped; a silent drop is what makes an importer
untrustworthy.

### UI

An "Import" tab in the add-music panel: textarea and file input, then progress
while the job runs, then the review list, then "Add matched".

---

## Robustness

The requirement is that an import survives everything a real one meets.

| Failure | Handling |
| --- | --- |
| User closes the tab mid-import | Work lives in the arq job, not the tab. Re-opening rejoins by `job_id`, held in `localStorage`. |
| One track is unfindable | Recorded as `not_found` and reported. Never aborts the batch. |
| yt-dlp transient failure | Up to 3 retries with exponential backoff inside the worker, then `failed` with the error surfaced verbatim. |
| Import starves live playback | Resolution runs on a **separate, lower-priority arq queue** from downloads. A room preparing a track must never wait behind a bulk import. |
| Same playlist imported twice | Resolution cache makes it near-free; queueing stays the user's explicit confirm. |
| Absurd input (50k-line file) | Hard cap of **500 tracks** per import, enforced server-side as well as in the UI, with the count left out stated plainly. |
| yt-dlp cookies expire | Surfaces as `failed` with the real error, the same way downloads already do. |
| Job never finishes | Per-track timeout, and a job TTL after which the job is marked failed rather than polling forever. |

june's polling reuses `shouldPollAgain` from `src/audio/downloads.ts`, which
already handles the empty-response grace window.

## Files

| Area | Files |
| --- | --- |
| Liked songs | `src/youtube/client.ts`, `src/youtube/schema.ts`, `src/lib/room/add-music.ts`, `app/room/[code]/add-music.tsx` |
| Parsing | new `src/discovery/tracklist.ts` |
| Import client | new `src/audio/resolve.ts` (client + Zod schema + poll policy) |
| Import flow | new `src/lib/room/import.ts`, `app/room/[code]/add-music.tsx` |
| mp3server | new `routes/resolve.py`, resolver in `ytdl.py`, arq job + `resolution` table |
| Tests (june) | `test/discovery/tracklist.test.ts`, `test/audio/resolve.test.ts` |
| Tests (mp3server) | duration matching and channel preference, as pure functions |

## Error handling

Existing rules hold: failures surface through `YouTubeResult`
(`not-configured` / `not-connected` / `failed`) or the job's per-track `error`,
shown verbatim rather than swallowed. An import where nothing resolves says so
plainly instead of presenting an empty success.

## Testing

TDD targets, all pure:

- `parseTrackList` — Exportify CSV with reordered and extra columns; quoted
  fields containing commas; multi-artist `Artist Name(s)`; plain `Artist - Title`
  with all three dashes; blank and malformed lines; de-duplication; the 500 cap.
- Duration matching (mp3server) — exact, nearest-within-tolerance, the 3s and 15s
  boundaries, missing duration, empty candidates.
- Channel preference (mp3server) — Topic channel beats a same-duration match.
- Poll policy (june) — reuses and extends the `shouldPollAgain` tests.

Integration: connect a YouTube account and check the Liked tab; import a real
Exportify CSV and confirm the review list distinguishes the three states; start
an import, close the tab, reopen, and confirm it rejoins the job.

## Out of scope

Spotify OAuth in any form. Playback of anything but june's own audio. Merging
playlists and likes into one library surface — that overlaps the pending UI
redesign. Writing playlists back to any service. Downloading audio at import
time.

## Open question

This spec was written against mp3server's documented interface
(`docs/ARCHITECTURE.md` and `src/audio/client.ts`) because the repository at
`../mp3server` could not be read from this session — macOS refused the path. The
mp3server half needs checking against the real code before implementation:
the arq queue setup, whether a second queue is straightforward, the existing
`ytdl.py` structure, and where a `resolution` table would live.

## Risks

- **Match quality is the whole feature.** A confident-looking wrong match is
  worse than a reported miss, which is why uncertain is a distinct state.
- **yt-dlp search is scraping.** It has no quota but no guarantees either; it
  breaks when YouTube changes, exactly as downloads already do, and is fixed the
  same way — by updating yt-dlp.
- **Exportify is a third party.** It is a dependency of the user's workflow, not
  of the code; any converter emitting the same columns substitutes for it.
