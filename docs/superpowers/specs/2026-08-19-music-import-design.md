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
CSV ─parse(june)─→ tracks ─POST /imports─→ parent job (kind=import)
                                                └─ one child per track
                                                     ├ prior resolution → reuse
                                                     └ ytsearch5 + duration check
june polls GET /imports/{job_id}  ←─ per-track: resolved | not_found | failed
```

This is the shape mp3server already has. `expand_playlist` turns one parent job
into N children and `finalize_parent` rolls their statuses back up into
`completed` / `partial` / `failed`. An import is that same fan-out with a
different unit of work, so it inherits the parent/child model, arq's retries,
the stale-job sweep and cancellation rather than reimplementing them.

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

A new `/imports` router, sitting on the existing job machinery:

```
POST /imports   { tracks: [{ title, artist, duration_ms }] }  → JobResponse (parent)
GET  /imports/{job_id}  → { status, done, total,
                            tracks: [{ title, artist,
                                       state: "resolved"|"not_found"|"failed",
                                       video_id?, matched_title?, confidence?,
                                       error? }] }
```

`POST` creates a parent `Job(kind="import")` plus one child `Job(kind="import_track")`
per track, then enqueues the children — the same sequence `expand_playlist`
performs, minus the network call, so it can happen inline in the request.

A track's inputs have nowhere to live in `jobs`: `Job.url` is `NOT NULL` and
there is no column for artist, title or duration. A new `import_tracks` table
carries them, one row per child job:

```
import_tracks(id, job_id → jobs.id, norm_key, title, artist,
              duration_ms, matched_title, confidence)
```

`norm_key` is the normalized `(artist, title)` and is also **the cache**: before
searching, look for the newest `import_tracks` row with the same `norm_key`
whose job completed, and reuse its `video_id`. One table, and the cache is a
by-product of history rather than a second thing to keep consistent.

The child job, per track:

1. **Reuse a prior resolution** on a `norm_key` hit. Re-importing a playlist, or
   a track shared across playlists, costs nothing.
2. **Search** with `ytsearch5:"<artist> <title>"` and `extract_flat`, which
   returns id, duration and channel without touching a video page — measured at
   1–2s per query, no cookies, no quota.
3. **Verify by duration.** Where the CSV supplied one, take the candidate
   closest to it: within 3s is `resolved` with high confidence; 3–15s resolves
   with low confidence; beyond 15s is `not_found` rather than a wrong match.
   Among candidates that pass, prefer one whose **channel name matches the CSV
   artist** — on a live search, official uploads come back with the artist as
   the channel (`channel='Portishead'`), so this is a direct comparison and not
   a guess at YouTube's naming. Without a duration, the artist-matching result
   wins, at low confidence.

This ordering matters, and a real search shows why. `Portishead Glory Box`
returns a 213s single edit first, on Portishead's own channel; the album version
a *Dummy* export names is 305s, and the only candidate near it is a 308s
remaster on someone else's channel. Ranking by channel first hands the user a
song ninety seconds shorter than the one they exported. Duration decides what is
even a candidate; the channel only breaks ties among the survivors.

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

Most of this is inherited rather than built — the download path already survives
these, and the import rides on the same machinery.

| Failure | Handling | New? |
| --- | --- | --- |
| User closes the tab mid-import | Work lives in the job, not the tab. Re-opening rejoins by `job_id`, held in `localStorage`. | existing |
| One track is unfindable | Recorded `not_found` on that child. `finalize_parent` reports the parent `partial`. Never aborts the batch. | existing |
| yt-dlp transient failure | `WorkerSettings.max_tries = 3` with arq's `Retry`; `ytdl.is_permanent_error` already skips retries for the unfixable. | existing |
| Worker crashes mid-import | `recover_stale_jobs` re-queues children and finalizes stuck parents, on startup and every 10 minutes. | existing |
| User cancels | `cancel_job` already cascades a parent's cancellation to its children. | existing |
| Job never finishes | `stale_job_minutes` sweep, plus arq's `job_timeout`. | existing |
| Import starves live playback | **Needs building.** See below. | new |
| Import locks the user out of downloads | **Needs fixing.** See below. | new |
| Absurd input | `import_max_tracks` setting, default 500, enforced server-side as well as in the UI — the same shape as the existing `playlist_max_entries`. | new |
| Same playlist imported twice | `norm_key` reuse makes it near-free; queueing stays the user's explicit confirm. | new |

### Import must not starve playback

`WorkerSettings.max_jobs` is **2**. Two bulk imports would occupy both slots and
a room waiting on a track would sit behind them. So resolution runs on a second
arq queue: a `ResolveWorkerSettings` with its own `queue_name` and its own
compose service, and `enqueue_job(..., _queue_name=...)` for import children.
Resolution is metadata-only — no ffmpeg, no disk — so the new service is small,
and the box has room (the three current services cap at 2.3GB of 6GB).

### The pending-job limit is a real bug

`create_download` refuses a job when the user has `max_pending_jobs_per_user`
(10) jobs in a pending state, and it counts **children**. A 500-track import
would leave the user unable to start any download until it finished. Playlists
already have this problem at up to 100 entries; the import makes it certain.

The fix belongs in `create_download` regardless of this feature: count only jobs
with `parent_id is null`. The limit is meant to cap how many things a user has
*asked for*, and asking for one playlist is one request.

## Files

| Area | Files |
| --- | --- |
| Liked songs | `src/youtube/client.ts`, `src/youtube/schema.ts`, `src/lib/room/add-music.ts`, `app/room/[code]/add-music.tsx` |
| Parsing | new `src/discovery/tracklist.ts` |
| Import client | new `src/audio/imports.ts` (client + Zod schema + poll policy) |
| Import flow | new `src/lib/room/import.ts`, `app/room/[code]/add-music.tsx` |
| mp3server | new `routes/imports.py`, `jobs/imports.py`; `ytdl.search()`; `resolve_track` + `ResolveWorkerSettings` in `worker.py`; `ImportTrack` in `models.py` + migration `0004`; `import_max_tracks` in `config.py`; `create_download` pending-count fix in `jobs/service.py`; `docker-compose.yml` |
| Tests (june) | `test/discovery/tracklist.test.ts`, `test/audio/imports.test.ts` |
| Tests (mp3server) | new `test_worker_resolve.py`, `test_api_imports.py`; duration/channel picking as pure functions in `test_ytdl.py`; the pending-count fix in `test_jobs_service.py` |

## Error handling

Existing rules hold: failures surface through `YouTubeResult`
(`not-configured` / `not-connected` / `failed`) or the job's per-track `error`,
shown verbatim rather than swallowed. An import where nothing resolves says so
plainly instead of presenting an empty success.

## Testing

TDD targets, all pure:

- `parseTrackList` (june) — Exportify CSV with reordered and extra columns;
  quoted fields containing commas; multi-artist `Artist Name(s)`; plain
  `Artist - Title` with all three dashes; blank and malformed lines;
  de-duplication; the 500 cap.
- Candidate picking (mp3server) — exact duration, nearest-within-tolerance, the
  3s and 15s boundaries, missing duration, empty candidates, and an
  artist-matching channel breaking a tie between two same-duration results.
  A pure function over a list of candidates, so it needs no network.
- `norm_key` (mp3server) — case, punctuation and feature-credit variations of
  the same track collapsing to one key.
- Pending-count fix (mp3server) — a user with 20 children of one parent can
  still create a download; a user with 10 parents cannot.
- Poll policy (june) — reuses and extends the `shouldPollAgain` tests.

Real search stays behind the existing `network` marker, which `pytest` skips by
default (`addopts = -m 'not network'`), so the suite has one opt-in test proving
`ytsearch` still returns what the picker expects.

Integration: connect a YouTube account and check the Liked tab; import a real
Exportify CSV and confirm the review list distinguishes the three states; start
an import, close the tab, reopen, and confirm it rejoins the job; start an
import and confirm a room can still queue and play a new track while it runs.

## Out of scope

Spotify OAuth in any form. Playback of anything but june's own audio. Merging
playlists and likes into one library surface — that overlaps the pending UI
redesign. Writing playlists back to any service. Downloading audio at import
time.

## What the mp3server code confirmed

This spec was first written against mp3server's documented interface. Its
source has since been read, which changed three things and left the rest
standing.

- **The fan-out already exists.** `expand_playlist` + `finalize_parent` +
  `recover_stale_jobs` are the import's parent/child model, retry policy and
  crash recovery, already built and tested. The import reuses them instead of
  adding a parallel job system, which is most of the robustness requirement.
- **The channel heuristic was wrong.** "Prefer an `- Topic` channel" was written
  from memory. A live `ytsearch` returns the artist as the channel name
  directly, so the check is a comparison against the CSV's artist — simpler, and
  actually correct.
- **Two defects surfaced that the import would expose**: the pending-job limit
  counting children, and `max_jobs = 2` letting an import starve playback. Both
  are described under Robustness.

Still unverified: nothing in the resolution path. `ytsearch5` was run against
the real service from this repo's virtualenv and returned ids, durations and
channels in 1–2s.

## Risks

- **Match quality is the whole feature.** A confident-looking wrong match is
  worse than a reported miss, which is why uncertain is a distinct state.
- **yt-dlp search is scraping.** It has no quota but no guarantees either; it
  breaks when YouTube changes, exactly as downloads already do, and is fixed the
  same way — by updating yt-dlp.
- **Exportify is a third party.** It is a dependency of the user's workflow, not
  of the code; any converter emitting the same columns substitutes for it.
