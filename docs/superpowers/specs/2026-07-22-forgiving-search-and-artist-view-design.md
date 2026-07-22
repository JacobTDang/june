# Forgiving search + artist view — design

## Problem

Today the "Add music" search is a thin pass-through to the iTunes song search:
`searchMusicAction(query)` calls `searchMusic(query, { limit: 8 })` and renders
the raw rows. Two gaps:

1. **Unforgiving.** Typos, extra whitespace, and "official video" / "lyrics"
   style noise in a query return few or poor results. The top rows are often
   karaoke, covers, live cuts, or remixes rather than the studio track people
   mean. There's no fallback when a query is sparse.
2. **No artist path.** Searching an artist's name only surfaces individual
   songs. There's no way to say "show me this artist" and browse their popular
   tracks, which is the natural next step when someone types a band name.

## Goals

- Make song search forgiving: tolerate typos/noise, rank the playable studio
  version first, and return more candidates.
- When a query looks like an artist, surface an **artist chip** at the top of
  results. Tapping it opens a **dedicated artist view** listing that artist's
  top songs, each individually addable, with a Back button to the results.
- Zero new dependencies. Stay entirely on the free iTunes Search API (no extra
  YouTube quota for discovery — resolution to a videoId is unchanged).

## Non-goals

- No "add all top songs" bulk action in the artist view — songs are added one
  at a time (matches the existing search UX; bulk import already exists for the
  user's own YouTube playlists).
- No new route/page. The artist view is internal state inside the existing
  `AddMusic` panel, like the playlist-browse view already is.
- No persisted artist favorites/following. This is browse-only.
- No change to how a picked candidate resolves to a YouTube videoId.

## Design

### 1. Data layer (`src/discovery`) — all iTunes, pure + tested

**a. Query normalization — `normalizeQuery(raw): string` (pure).**
Collapses whitespace, trims, and strips common noise tokens people paste from
elsewhere (`official video`, `official audio`, `lyrics`, `lyric video`, `hd`,
`mv`, `m/v`, `feat.`/`ft.` kept as-is since iTunes handles them). Returns the
cleaned term. This is the "typo/noise tolerance" lever we control; iTunes'
own matching handles minor misspellings.

**b. Result ranking — `rankSongResults(candidates): MusicCandidate[]` (pure).**
Stable sort that *deprioritizes* (does not drop) rows whose title matches
karaoke / cover / tribute / live / remix / instrumental / sped-up patterns, so
the studio version floats to the top while alternatives remain available lower
down. Ties keep iTunes' original relevance order (stable sort).

**c. `searchMusic` enhancements.**
- Raise default `limit` from 10 to ~15 (more candidates to rank).
- Normalize the term via `normalizeQuery` before the request.
- Apply `rankSongResults` to the parsed candidates before returning.
- **Relaxed retry on sparse results:** if the first search returns very few
  rows (e.g. < 3) *and* normalization changed the term, retry once with the
  raw term. Fail loud on HTTP errors (unchanged); the retry is only for the
  empty/sparse case, never to mask an error.

**d. `searchArtists(query, opts): Promise<ArtistCandidate[]>` (new).**
Calls iTunes with `entity=musicArtist`. Returns normalized artist rows:
`{ artistId, name, genre?, artworkUrl?, source: "itunes" }`. iTunes artist
entities carry **no artwork**, so artwork is left undefined here and filled in
by the action layer (see 2b) by borrowing a top song's cover. Drops rows
missing an `artistId` or `name`.

**e. `getArtistTopSongs(artistId, opts): Promise<MusicCandidate[]>` (new).**
Calls the iTunes `lookup` endpoint (`?id=<artistId>&entity=song&limit=N`),
which returns the artist wrapper followed by their songs. Filters to song rows,
normalizes to `MusicCandidate[]` (reusing the same mapping as `searchMusic`),
and applies `rankSongResults`. The lookup's own order is roughly popularity, so
ranking mainly demotes karaoke/live noise.

**Schema (`src/discovery/schema.ts`).** Extend the iTunes row schema with the
optional artist fields (`wrapperType`, `artistId`, `primaryGenreName`) so the
same parser validates both `search?entity=musicArtist` and `lookup` responses.
All additions optional — existing song parsing is unaffected.

### 2. Action layer (`src/lib/room/add-music.ts`)

**a. `searchMusicAction(query)` returns `{ songs, artists }`.**
Runs `searchMusic` and `searchArtists` concurrently. Returns both lists. This
changes the return type (currently `MusicCandidate[]`), so the client and any
callers update together.

**b. Artist chip decision — `pickArtistMatch(query, artists): ArtistCandidate | null` (pure).**
Decides whether to show an artist chip and which artist. Only surfaces a chip
when an artist name is a strong match for the (normalized) query — e.g. the top
artist's name equals or closely contains the query — to avoid a noisy chip on
every song search. Artwork for the chosen artist is borrowed from the first of
their top songs (fetched when the chip is built, or lazily when opened —
decided in the plan; borrowing on open keeps the search response cheap).

**c. `getArtistTopSongsAction(artistId)` (new).**
Thin server action wrapping `getArtistTopSongs`, for the artist view to call
when opened.

### 3. UI (`app/room/[code]/add-music.tsx`)

- The search results area gains an optional **artist chip** above the song
  list when `pickArtistMatch` returned one: a compact row with the artist's
  (borrowed) cover, name, and a chevron affording "open".
- Tapping the chip switches the panel into an **artist view** (new internal
  state, same pattern as the existing `openPlaylist` view): a header with a
  **Back** button (returns to results, preserving them) and the artist name,
  then the artist's top songs as individually-addable rows (reusing the
  existing `add__result` row + `addCandidate` add button).
- Song results otherwise render as today. The relaxed/ranked results just make
  the list better; no structural change to the song rows.
- Empty/sparse handling: if both songs and artists are empty, show the existing
  "no results" affordance (unchanged copy).

### 4. Testing (TDD, pure helpers first)

Write tests before implementation, in this order:

1. `normalizeQuery` — whitespace collapse, noise-token stripping, keeps real
   terms, leaves clean queries untouched.
2. `rankSongResults` — karaoke/cover/live/remix demoted below studio; stable
   for ties; never drops rows.
3. `pickArtistMatch` — exact/close name → chip; unrelated top artist → null;
   empty list → null.
4. `searchMusic` — extends existing tests: sends normalized term, applies
   ranking, relaxed retry fires only on sparse+changed-term (assert the second
   fetch uses the raw term), never on HTTP error.
5. `searchArtists` — builds `entity=musicArtist` request, normalizes rows,
   drops rows missing id/name, artwork undefined.
6. `getArtistTopSongs` — builds the `lookup` request, filters to song rows,
   ranks them.

All pure helpers live in import-clean files (no `import "server-only"`) so
Vitest can import them with relative paths (`../../src/...`), consistent with
the existing `admin-identity.ts` / `thumbnail.ts` split. Fetch is injected via
the existing `FetchLike` stub pattern — no network in tests.

## Risks / decisions

- **Extra iTunes call per search.** `searchMusicAction` now makes two iTunes
  requests (songs + artists) concurrently. iTunes is free and unmetered for our
  volume; acceptable. If artist artwork is borrowed lazily (on chip open) we
  avoid a third call on every keystroke-search.
- **Artist chip false positives.** `pickArtistMatch` is deliberately
  conservative (strong-match only) so song searches don't sprout an irrelevant
  chip. Tunable via tests.
- **Ranking demotes, never drops.** A user searching *for* a karaoke/live
  version still finds it lower in the list — we don't hide results, just
  reorder. Fail-loud principle preserved: HTTP errors still throw.
- **Return-type change** to `searchMusicAction` touches the client in the same
  change; no other callers (verified — only `add-music.tsx` consumes it).
