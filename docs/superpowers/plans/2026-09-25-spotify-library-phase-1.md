# Spotify Library, Phase 1 (Connect + Library) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A june user connects their Spotify account, and june syncs their liked songs, owned playlists, recent listens and top artists/tracks into Supabase every 30 minutes, shown on a new `/library` page.

**Architecture:** Pure modules in `src/spotify/` hold the Zod boundary, the HTTP client, the OAuth helpers and every sync decision (what is new, what changed, when a token needs refreshing). `src/lib/spotify/sync-user.ts` orchestrates one user's sync against two injected interfaces (a `SpotifyClient` and a `LibraryStore`), so it is tested with in-memory fakes. Supabase-backed IO lives in `server-only` modules. pg_cron calls `POST /api/spotify/sync` through pg_net; the route answers 202 and syncs in `after()`.

**Tech Stack:** Next.js 16.2 App Router (route handlers, server actions, `after`), React 19, TypeScript (strict, `noUncheckedIndexedAccess`), Zod 4, `@supabase/supabase-js` + `@supabase/ssr`, Postgres (RLS, `SECURITY DEFINER` functions, pg_cron, pg_net, Vault), Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-25-spotify-library-design.md`. Phase 1 only. Matching (phase 2) and keeping audio (phase 3) get their own plans; the `songs` match columns are created here but nothing writes them yet.

**Two small departures from the spec's data model, both deliberate:** `spotify_connections` has no `scopes` column (nothing reads it), and `playlists.snapshot_id` / `synced_at` are nullable with `song_count default 0`, so a playlist row can exist before its songs are read and is re-read if a run dies half way.

## Global Constraints

- **No new dependencies.** Everything here uses packages already in `package.json`.
- **One Supabase project serves dev and prod** (`ksqjgsezfqfevnfvonnm`). Applying a migration is a production change. Both migrations here are additive.
- **Tests:** Vitest, files under `test/`, relative imports (`../../src/...`), `fetch` injected, no network. Mock data only in tests.
- **Pure modules never import** `server-only`, `next/*`, or a Supabase client. IO modules start with `import "server-only";`. A test that imports an IO module fails, which is the guard.
- **CSS uses the scales.** `test/design/tokens.test.ts` fails on any font-size, spacing, weight, tracking or leading that isn't a `var(--text-*)`, `var(--space-*)`, `var(--weight-*)`, `var(--track-*)` or `var(--leading-*)`.
- **Fail loud.** Every caught error is either recorded where the user sees it (`spotify_connections.last_error`, a notice on `/library`) or logged with `console.error`. No empty `catch`.
- **Spotify API, February 2026 shape:** playlist contents come from `GET /playlists/{id}/items`, each entry's track is under `item` (not `track`), page size 50. Development Mode returns items only for playlists the user owns or collaborates on.
- **Env vars (server-only):** `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_SYNC_SECRET`.
- **Redirect URIs:** `https://june-jam.vercel.app/api/spotify/callback` and `http://127.0.0.1:3000/api/spotify/callback`. Spotify rejects `localhost`, so local work on this feature happens at `http://127.0.0.1:3000`.
- **Scopes:** `user-library-read playlist-read-private playlist-read-collaborative user-top-read user-read-recently-played`.
- **Not-approved copy, verbatim:** `Spotify hasn't approved this account for june yet — ask Jacob to add it.`
- **Commits:** a plain descriptive message covering what changed and why, in the style of `git log`. Never mention Claude; no `Co-Authored-By` line. Push after every commit (`git push`). Work on branch `spotify-library`.

## Setup the user does (needed before Task 11)

Tasks 1–10 need none of this. Task 11 stops and asks for it if missing.

1. **Spotify app.** At https://developer.spotify.com/dashboard, signed in with the Premium account: create an app named `june`, API = Web API, and add both redirect URIs above. Under **User Management**, add your own Spotify email (and later, each friend's).
2. **Local env.** Add to `.env.local`: `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` (from the app's settings), and `SPOTIFY_SYNC_SECRET` (generate with `openssl rand -hex 32`).
3. **Supabase Auth.** Authentication → URL Configuration → Redirect URLs: add `http://127.0.0.1:3000/**`, so Google sign-in works on `127.0.0.1`.
4. **Vercel.** Add the same three env vars to Production (before Task 12's deploy).
5. **Vault secret** (before Task 12's cron). In the Supabase SQL editor, not in chat: `select vault.create_secret('<the SPOTIFY_SYNC_SECRET value>', 'spotify_sync_secret');`

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260925000000_spotify_library.sql` | Tables, RLS, `my_spotify_connection`, `replace_playlist_songs`, the sync lease |
| `supabase/migrations/20260925000100_spotify_sync_cron.sql` | pg_net + the 30-minute cron job |
| `src/spotify/limits.ts` | Page sizes and time ranges shared by client and diff |
| `src/spotify/errors.ts` | `SpotifyApiError`, `SpotifyAuthError`, `classifySyncError`, `isNotApprovedForApp` |
| `src/spotify/schema.ts` | Zod schemas for every Spotify response read |
| `src/spotify/map.ts` | Spotify objects → `songs` rows, playlist meta, taste items |
| `src/spotify/diff.ts` | Pure sync decisions: fresh likes, removed likes, playlist plan, cursor, gap, token/daily/sync-now timing |
| `src/spotify/oauth.ts` | Authorize URL, code exchange, refresh, state cookie check |
| `src/spotify/client.ts` | `createSpotifyClient`: typed Web API reads with paging and 429 handling |
| `src/lib/spotify/sync-user.ts` | `LibraryStore` interface + `syncUser` orchestration (pure, injectable) |
| `src/lib/spotify/store.ts` | `supabaseLibraryStore`: `LibraryStore` over the service client |
| `src/lib/spotify/connection.ts` | Connection rows: save, list, refresh token, record outcome, lease, delete |
| `src/lib/spotify/sync.ts` | `syncAllUsers`, `syncOneUser`: lease + per-user error handling |
| `src/lib/spotify/config.ts` | Env config, redirect URI, state cookie name |
| `src/lib/spotify/secret.ts` | `bearerMatches` (constant-time) |
| `src/lib/spotify/messages.ts` | `/library` copy: connect errors, status line |
| `src/lib/spotify/library.ts` | RLS-scoped reads for `/library` |
| `src/lib/spotify/actions.ts` | Server actions: Sync now, Disconnect, Delete data |
| `src/lib/when.ts` | Relative time ("5m ago"), moved out of `app/recent-plays.tsx` |
| `app/api/spotify/connect/route.ts` | Start OAuth |
| `app/api/spotify/callback/route.ts` | Finish OAuth, save, first sync |
| `app/api/spotify/sync/route.ts` | Cron entry point |
| `app/library/page.tsx` | The library page |
| `app/library/spotify-controls.tsx` | Client buttons for the connection |
| `app/library/song-list.tsx` | A list of songs with art and time |

---

### Task 1: Database schema

**Files:**
- Create: `supabase/migrations/20260925000000_spotify_library.sql`

**Interfaces:**
- Produces tables `songs`, `spotify_connections`, `library_songs`, `playlists`, `playlist_songs`, `listens`, `taste_snapshots`, `spotify_sync_lease`, and functions:
  - `my_spotify_connection() returns table (display_name text, status text, connected_at timestamptz, last_synced_at timestamptz, last_error text, last_error_at timestamptz)`, executable by `authenticated`
  - `replace_playlist_songs(p_playlist uuid, p_snapshot text, p_song_ids uuid[], p_added_at timestamptz[]) returns void`, `service_role` only
  - `claim_spotify_sync(p_seconds integer) returns uuid` (null when held), `service_role` only
  - `release_spotify_sync(p_holder uuid) returns void`, `service_role` only

- [ ] **Step 1: Write the verification queries (they fail now)**

Run with the Supabase MCP `execute_sql` tool:

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('songs','spotify_connections','library_songs','playlists',
                    'playlist_songs','listens','taste_snapshots','spotify_sync_lease')
order by tablename;
```

Expected now: 0 rows. After Step 4: 8 rows, every `rowsecurity = true`.

```sql
select p.proname,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authed,
       has_function_privilege('service_role', p.oid, 'execute')  as service
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('my_spotify_connection','replace_playlist_songs',
                    'claim_spotify_sync','release_spotify_sync')
order by p.proname;
```

Expected now: 0 rows. After Step 4:

| proname | anon | authed | service |
| --- | --- | --- | --- |
| claim_spotify_sync | f | f | t |
| my_spotify_connection | f | t | t |
| release_spotify_sync | f | f | t |
| replace_playlist_songs | f | f | t |

- [ ] **Step 2: Run them to confirm they fail**

Both return 0 rows.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260925000000_spotify_library.sql`:

```sql
-- A Spotify library for each connected user: the songs they like, the
-- playlists they own, what they play, and Spotify's own top lists.
-- Spec: docs/superpowers/specs/2026-09-25-spotify-library-design.md
--
-- Everything here is written by the sync with the service role. Users only
-- read, and only their own rows — except songs, which name no user and are
-- shared, so a song two people like is matched and stored once.

create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('spotify')),
  source_id text not null,
  isrc text,
  title text not null,
  artists text[] not null,
  album text,
  duration_ms integer,
  artwork_url text,
  -- Written by matching (phase 2). The sync never sends these columns, so an
  -- upsert can't reset a song that has already been matched.
  match_state text not null default 'pending'
    check (match_state in ('pending', 'matching', 'matched', 'not_found', 'failed')),
  match_job_id uuid,
  match_position integer,
  video_id text,
  video_duration_ms integer,
  match_confidence text check (match_confidence in ('high', 'low')),
  matched_at timestamptz,
  created_at timestamptz not null default now(),
  unique (source, source_id)
);

create index if not exists songs_match_state_idx on public.songs (match_state, created_at);

alter table public.songs enable row level security;
drop policy if exists songs_select on public.songs;
create policy songs_select on public.songs for select to authenticated using (true);

create table if not exists public.spotify_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  spotify_user_id text not null unique,
  display_name text,
  refresh_token text not null,
  access_token text,
  access_token_expires_at timestamptz,
  status text not null default 'active' check (status in ('active', 'revoked')),
  -- The newest played_at already stored. recently-played only keeps 50 plays,
  -- so this is what stops a play being stored twice.
  recent_cursor timestamptz,
  last_synced_at timestamptz,
  last_daily_sync_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  connected_at timestamptz not null default now()
);

-- No policies on purpose: the tokens are readable by the service role only.
-- The owner reads their status through my_spotify_connection().
alter table public.spotify_connections enable row level security;

create or replace function public.my_spotify_connection()
returns table (
  display_name text,
  status text,
  connected_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  last_error_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select c.display_name, c.status, c.connected_at, c.last_synced_at, c.last_error, c.last_error_at
  from public.spotify_connections c
  where c.user_id = auth.uid();
$$;

revoke execute on function public.my_spotify_connection() from public, anon;
grant execute on function public.my_spotify_connection() to authenticated;

create table if not exists public.library_songs (
  user_id uuid not null references auth.users(id) on delete cascade,
  song_id uuid not null references public.songs(id),
  source text not null check (source in ('spotify')),
  added_at timestamptz not null,
  primary key (user_id, source, song_id)
);

create index if not exists library_songs_user_added_idx
  on public.library_songs (user_id, added_at desc);

alter table public.library_songs enable row level security;
drop policy if exists library_songs_select on public.library_songs;
create policy library_songs_select on public.library_songs for select to authenticated
  using (user_id = auth.uid());

create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('spotify')),
  source_id text not null,
  name text not null,
  description text,
  artwork_url text,
  -- Null until the playlist's songs have been read once. Set together with
  -- them by replace_playlist_songs, so a run that dies half way re-reads it.
  snapshot_id text,
  song_count integer not null default 0,
  synced_at timestamptz,
  unique (user_id, source, source_id)
);

alter table public.playlists enable row level security;
drop policy if exists playlists_select on public.playlists;
create policy playlists_select on public.playlists for select to authenticated
  using (user_id = auth.uid());

create table if not exists public.playlist_songs (
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  position integer not null,
  song_id uuid not null references public.songs(id),
  added_at timestamptz,
  primary key (playlist_id, position)
);

alter table public.playlist_songs enable row level security;
drop policy if exists playlist_songs_select on public.playlist_songs;
create policy playlist_songs_select on public.playlist_songs for select to authenticated
  using (exists (
    select 1 from public.playlists p
    where p.id = playlist_id and p.user_id = auth.uid()
  ));

-- Plays outside june. Kept apart from plays, which means "heard in a june
-- room" and carries room, skip and listened-ms data Spotify doesn't give.
create table if not exists public.listens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  song_id uuid not null references public.songs(id),
  source text not null check (source in ('spotify')),
  played_at timestamptz not null,
  unique (user_id, source, played_at)
);

create index if not exists listens_user_played_idx on public.listens (user_id, played_at desc);

alter table public.listens enable row level security;
drop policy if exists listens_select on public.listens;
create policy listens_select on public.listens for select to authenticated
  using (user_id = auth.uid());

create table if not exists public.taste_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('spotify')),
  kind text not null check (kind in ('artists', 'tracks')),
  time_range text not null check (time_range in ('short_term', 'medium_term', 'long_term')),
  items jsonb not null,
  fetched_at timestamptz not null,
  primary key (user_id, source, kind, time_range)
);

alter table public.taste_snapshots enable row level security;
drop policy if exists taste_snapshots_select on public.taste_snapshots;
create policy taste_snapshots_select on public.taste_snapshots for select to authenticated
  using (user_id = auth.uid());

-- A playlist's songs are replaced whole, and its snapshot recorded only once
-- they are in. PostgREST can't run several statements in one transaction, so
-- this does it as one call.
create or replace function public.replace_playlist_songs(
  p_playlist uuid,
  p_snapshot text,
  p_song_ids uuid[],
  p_added_at timestamptz[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(array_length(p_song_ids, 1), 0) <> coalesce(array_length(p_added_at, 1), 0) then
    raise exception 'replace_playlist_songs: % song ids but % timestamps',
      coalesce(array_length(p_song_ids, 1), 0), coalesce(array_length(p_added_at, 1), 0);
  end if;

  delete from public.playlist_songs where playlist_id = p_playlist;

  insert into public.playlist_songs (playlist_id, position, song_id, added_at)
  select p_playlist, s.ord - 1, s.song_id, s.added_at
  from unnest(p_song_ids, p_added_at) with ordinality as s(song_id, added_at, ord);

  update public.playlists
  set snapshot_id = p_snapshot,
      song_count = coalesce(array_length(p_song_ids, 1), 0),
      synced_at = now()
  where id = p_playlist;

  if not found then
    raise exception 'replace_playlist_songs: no playlist %', p_playlist;
  end if;
end;
$$;

revoke execute on function public.replace_playlist_songs(uuid, text, uuid[], timestamptz[])
  from public, anon, authenticated;
grant execute on function public.replace_playlist_songs(uuid, text, uuid[], timestamptz[])
  to service_role;

-- One sync at a time. The lease expires on its own, so a run that crashes
-- can't hold it forever; the holder id stops a late run releasing a lease
-- someone else has since taken.
create table if not exists public.spotify_sync_lease (
  id integer primary key check (id = 1),
  holder uuid,
  held_until timestamptz not null default '-infinity'
);

insert into public.spotify_sync_lease (id) values (1) on conflict (id) do nothing;

alter table public.spotify_sync_lease enable row level security;

create or replace function public.claim_spotify_sync(p_seconds integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_holder uuid := gen_random_uuid();
begin
  update public.spotify_sync_lease
  set holder = v_holder, held_until = now() + make_interval(secs => p_seconds)
  where id = 1 and held_until < now();
  if found then
    return v_holder;
  end if;
  return null;
end;
$$;

create or replace function public.release_spotify_sync(p_holder uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.spotify_sync_lease
  set holder = null, held_until = now()
  where id = 1 and holder = p_holder;
$$;

revoke execute on function public.claim_spotify_sync(integer) from public, anon, authenticated;
grant execute on function public.claim_spotify_sync(integer) to service_role;
revoke execute on function public.release_spotify_sync(uuid) from public, anon, authenticated;
grant execute on function public.release_spotify_sync(uuid) to service_role;
```

- [ ] **Step 4: Apply it**

Use the Supabase MCP `apply_migration` tool with name `spotify_library` and the file's full contents as the query. This is the shared dev/prod database; the migration only adds objects.

- [ ] **Step 5: Run the verification queries again**

Both now return the expected rows from Step 1. Then check the lease works and put it back:

```sql
select public.claim_spotify_sync(5) is not null as first_claim;
```

Expected: `first_claim = true`. Then, as a separate statement:

```sql
select public.claim_spotify_sync(5) is null as second_refused;
```

Expected: `second_refused = true`.

```sql
select public.release_spotify_sync(holder) from public.spotify_sync_lease where id = 1;
select holder is null as released from public.spotify_sync_lease where id = 1;
```

Expected: `released = true`.

Then run the Supabase MCP `get_advisors` tool with type `security`. It may report "RLS enabled, no policy" for `spotify_connections` and `spotify_sync_lease`; that is intended (service role only). Anything else it reports about the new tables or functions must be fixed before committing.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260925000000_spotify_library.sql
git commit -m "Add the Spotify library tables

Songs are shared and name no user; likes, playlists, listens and taste
snapshots are owner-only. Connection tokens are service-role only, with the
owner reading their status through my_spotify_connection. A playlist's songs
and snapshot are replaced in one call, and a lease keeps syncs from
overlapping."
git push
```

---

### Task 2: Spotify errors, limits and response schemas

**Files:**
- Create: `src/spotify/limits.ts`, `src/spotify/errors.ts`, `src/spotify/schema.ts`
- Test: `test/spotify/errors.test.ts`, `test/spotify/schema.test.ts`

**Interfaces:**
- Produces (`limits.ts`): `SPOTIFY_PAGE_SIZE = 50`, `RECENTLY_PLAYED_LIMIT = 50`, `type TimeRange = "short_term" | "medium_term" | "long_term"`, `TIME_RANGES: readonly TimeRange[]`
- Produces (`errors.ts`): `class SpotifyApiError(status: number, message: string, retryAfterSeconds: number | null = null)`, `class SpotifyAuthError(code: string, message: string)`, `type SyncFailure`, `classifySyncError(err: unknown): SyncFailure`, `isNotApprovedForApp(err: unknown): boolean`
- Produces (`schema.ts`): schemas `trackSchema`, `tokenResponseSchema`, `meSchema`, `recentlyPlayedSchema`, `savedTracksPageSchema`, `playlistSummarySchema`, `playlistsPageSchema`, `playlistItemsPageSchema`, `topArtistSchema`, `topArtistsSchema`, `topTracksSchema`; types `SpotifyTrack`, `SpotifyMe`, `RecentlyPlayedItem`, `SavedTrack`, `SavedTracksPage`, `PlaylistSummary`, `PlaylistItem`, `TopArtist`

- [ ] **Step 1: Write the failing tests**

Create `test/spotify/errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  classifySyncError,
  isNotApprovedForApp,
  SpotifyApiError,
  SpotifyAuthError,
} from "../../src/spotify/errors";

describe("classifySyncError", () => {
  it("treats a 429 as rate-limited and keeps Retry-After", () => {
    const failure = classifySyncError(new SpotifyApiError(429, "slow down", 30));
    expect(failure).toEqual({ kind: "rate-limited", message: "slow down", retryAfterSeconds: 30 });
  });

  it("treats a revoked grant as revoked", () => {
    const failure = classifySyncError(new SpotifyAuthError("invalid_grant", "Refresh token revoked"));
    expect(failure).toEqual({ kind: "revoked", message: "Refresh token revoked" });
  });

  it("treats any other API error as a failure for that user alone", () => {
    expect(classifySyncError(new SpotifyApiError(500, "boom"))).toEqual({
      kind: "failed",
      message: "boom",
    });
  });

  it("keeps the message of an unexpected error", () => {
    expect(classifySyncError(new Error("db down"))).toEqual({ kind: "failed", message: "db down" });
    expect(classifySyncError("weird")).toEqual({ kind: "failed", message: "weird" });
  });
});

describe("isNotApprovedForApp", () => {
  it("is true only for a 403 from the Web API", () => {
    expect(isNotApprovedForApp(new SpotifyApiError(403, "user may not be registered"))).toBe(true);
    expect(isNotApprovedForApp(new SpotifyApiError(401, "expired"))).toBe(false);
    expect(isNotApprovedForApp(new SpotifyAuthError("invalid_client", "bad"))).toBe(false);
  });
});
```

Create `test/spotify/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  meSchema,
  playlistItemsPageSchema,
  playlistsPageSchema,
  recentlyPlayedSchema,
  savedTracksPageSchema,
  tokenResponseSchema,
  topArtistsSchema,
  trackSchema,
} from "../../src/spotify/schema";

const track = {
  type: "track",
  id: "4uLU6hMCjMI75M1A2tKUQC",
  name: "Glory Box",
  duration_ms: 305_000,
  is_local: false,
  artists: [{ id: "6liAMWkVf5LH7YR9yfFy1Y", name: "Portishead" }],
  album: {
    name: "Dummy",
    images: [{ url: "https://i.scdn.co/image/large", height: 640, width: 640 }],
  },
  external_ids: { isrc: "GBBKS9400010" },
  popularity: 70,
};

describe("trackSchema", () => {
  it("keeps the fields june uses and drops the rest", () => {
    const parsed = trackSchema.parse(track);
    expect(parsed.name).toBe("Glory Box");
    expect(parsed.artists?.[0]?.name).toBe("Portishead");
    expect(parsed.album?.images?.[0]?.url).toBe("https://i.scdn.co/image/large");
    expect(parsed.external_ids?.isrc).toBe("GBBKS9400010");
    expect("popularity" in parsed).toBe(false);
  });

  it("accepts a local file, which has no id", () => {
    expect(trackSchema.parse({ ...track, id: null, is_local: true }).id).toBeNull();
  });

  it("accepts an episode, which has no artists or album", () => {
    const parsed = trackSchema.parse({ type: "episode", id: "ep1", name: "A podcast" });
    expect(parsed.artists).toBeUndefined();
    expect(parsed.album).toBeUndefined();
  });

  it("rejects a track with no name", () => {
    const { name: _name, ...nameless } = track;
    expect(() => trackSchema.parse(nameless)).toThrow();
  });
});

describe("tokenResponseSchema", () => {
  it("accepts a refresh answer with no new refresh token", () => {
    const parsed = tokenResponseSchema.parse({
      access_token: "a",
      token_type: "Bearer",
      expires_in: 3600,
    });
    expect(parsed.refresh_token).toBeUndefined();
  });

  it("rejects an empty access token", () => {
    expect(() => tokenResponseSchema.parse({ access_token: "", expires_in: 3600 })).toThrow();
  });
});

describe("page schemas", () => {
  it("reads the current user, whose display name may be null", () => {
    expect(meSchema.parse({ id: "jacob", display_name: null })).toEqual({
      id: "jacob",
      display_name: null,
    });
  });

  it("reads recently played with its timestamps", () => {
    const parsed = recentlyPlayedSchema.parse({
      items: [{ track, played_at: "2026-09-25T11:00:00.000Z", context: null }],
      cursors: { after: "1", before: "0" },
    });
    expect(parsed.items[0]?.played_at).toBe("2026-09-25T11:00:00.000Z");
  });

  it("reads a saved-tracks page and its next link", () => {
    const parsed = savedTracksPageSchema.parse({
      items: [{ added_at: "2026-09-20T00:00:00Z", track }],
      next: null,
      total: 1,
    });
    expect(parsed.items[0]?.track.id).toBe(track.id);
    expect(parsed.next).toBeNull();
  });

  it("reads playlists with their owner and snapshot", () => {
    const parsed = playlistsPageSchema.parse({
      items: [
        {
          id: "pl1",
          name: "Late",
          description: "",
          collaborative: false,
          owner: { id: "jacob", display_name: "Jacob" },
          snapshot_id: "snap1",
          images: null,
          public: true,
        },
      ],
      next: "https://api.spotify.com/v1/me/playlists?offset=50&limit=50",
    });
    expect(parsed.items[0]?.owner.id).toBe("jacob");
    expect(parsed.items[0]?.snapshot_id).toBe("snap1");
  });

  it("reads playlist entries under `item`, including removed ones", () => {
    const parsed = playlistItemsPageSchema.parse({
      items: [
        { added_at: "2026-01-01T00:00:00Z", is_local: false, item: track },
        { added_at: null, item: null },
      ],
      next: null,
    });
    expect(parsed.items[0]?.item?.name).toBe("Glory Box");
    expect(parsed.items[1]?.item).toBeNull();
  });

  it("reads top artists", () => {
    const parsed = topArtistsSchema.parse({
      items: [{ id: "ar1", name: "Portishead", genres: ["trip hop"], images: [] }],
    });
    expect(parsed.items[0]?.genres).toEqual(["trip hop"]);
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx vitest run test/spotify/errors.test.ts test/spotify/schema.test.ts`
Expected: FAIL, "Failed to resolve import ../../src/spotify/errors" (and `schema`).

- [ ] **Step 3: Write the implementation**

Create `src/spotify/limits.ts`:

```ts
/** The largest page every Spotify endpoint june reads accepts. */
export const SPOTIFY_PAGE_SIZE = 50;

/** recently-played keeps only this many plays, whatever the cursor says. */
export const RECENTLY_PLAYED_LIMIT = 50;

export type TimeRange = "short_term" | "medium_term" | "long_term";

/** Spotify's three windows for top items: ~4 weeks, ~6 months, ~1 year. */
export const TIME_RANGES: readonly TimeRange[] = ["short_term", "medium_term", "long_term"];
```

Create `src/spotify/errors.ts`:

```ts
/** A non-OK answer from the Web API. On a 429, `retryAfterSeconds` carries
 *  Spotify's Retry-After when it sent one. */
export class SpotifyApiError extends Error {
  readonly status: number;
  readonly retryAfterSeconds: number | null;

  constructor(status: number, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "SpotifyApiError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** A refused token request. `code` is Spotify's OAuth error, e.g.
 *  "invalid_grant" when the user revoked june's access. */
export class SpotifyAuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SpotifyAuthError";
    this.code = code;
  }
}

export type SyncFailure =
  | { kind: "rate-limited"; message: string; retryAfterSeconds: number | null }
  | { kind: "revoked"; message: string }
  | { kind: "failed"; message: string };

/**
 * What a failed sync means for the run. A 429 stops everyone, because
 * Development Mode counts quota across the whole developer account; a revoked
 * grant needs the user to reconnect; anything else is that user's alone.
 */
export function classifySyncError(err: unknown): SyncFailure {
  if (err instanceof SpotifyApiError && err.status === 429) {
    return { kind: "rate-limited", message: err.message, retryAfterSeconds: err.retryAfterSeconds };
  }
  if (err instanceof SpotifyAuthError && err.code === "invalid_grant") {
    return { kind: "revoked", message: err.message };
  }
  return { kind: "failed", message: err instanceof Error ? err.message : String(err) };
}

/** Development Mode answers 403 for a Spotify account that hasn't been added
 *  in the developer dashboard. */
export function isNotApprovedForApp(err: unknown): boolean {
  return err instanceof SpotifyApiError && err.status === 403;
}
```

Create `src/spotify/schema.ts`:

```ts
import { z } from "zod";

/**
 * Zod schemas for the Spotify Web API responses june reads, validated at the
 * network boundary as src/youtube/schema.ts does for YouTube: a shape Spotify
 * changes fails here, loudly, not as `undefined` deep in the sync. Only the
 * fields june uses are declared; Zod strips the rest.
 *
 * Field names follow the February 2026 API: a playlist entry's track is under
 * `item`, not `track`.
 */

const imageSchema = z.object({ url: z.string() });

/** A track anywhere Spotify lists one. Local files carry a null id; podcast
 *  episodes, which playlists can hold, have no artists or album. */
export const trackSchema = z.object({
  type: z.string(),
  id: z.string().nullable(),
  name: z.string(),
  duration_ms: z.number().int().nonnegative().optional(),
  is_local: z.boolean().optional(),
  artists: z.array(z.object({ name: z.string() })).optional(),
  album: z
    .object({
      name: z.string(),
      // Largest first, as Spotify orders them.
      images: z.array(imageSchema).nullable().optional(),
    })
    .optional(),
  external_ids: z.object({ isrc: z.string().optional() }).optional(),
});

export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  // Present on the code exchange; on a refresh only when Spotify rotates it.
  refresh_token: z.string().min(1).optional(),
});

export const meSchema = z.object({
  id: z.string().min(1),
  display_name: z.string().nullable().optional(),
});

export const recentlyPlayedSchema = z.object({
  items: z.array(z.object({ track: trackSchema, played_at: z.string() })),
});

function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), next: z.string().nullable() });
}

export const savedTracksPageSchema = pageOf(
  z.object({ added_at: z.string(), track: trackSchema }),
);

export const playlistSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  description: z.string().nullable().optional(),
  collaborative: z.boolean(),
  owner: z.object({ id: z.string() }),
  snapshot_id: z.string(),
  images: z.array(imageSchema).nullable().optional(),
});

export const playlistsPageSchema = pageOf(playlistSummarySchema);

export const playlistItemsPageSchema = pageOf(
  z.object({
    added_at: z.string().nullable().optional(),
    // Null when the entry's track was removed from Spotify's catalog.
    item: trackSchema.nullable(),
  }),
);

export const topArtistSchema = z.object({
  id: z.string(),
  name: z.string(),
  genres: z.array(z.string()).optional(),
  images: z.array(imageSchema).nullable().optional(),
});

export const topArtistsSchema = z.object({ items: z.array(topArtistSchema) });

export const topTracksSchema = z.object({ items: z.array(trackSchema) });

export type SpotifyTrack = z.infer<typeof trackSchema>;
export type SpotifyMe = z.infer<typeof meSchema>;
export type RecentlyPlayedItem = z.infer<typeof recentlyPlayedSchema>["items"][number];
export type SavedTracksPage = z.infer<typeof savedTracksPageSchema>;
export type SavedTrack = SavedTracksPage["items"][number];
export type PlaylistSummary = z.infer<typeof playlistSummarySchema>;
export type PlaylistItem = z.infer<typeof playlistItemsPageSchema>["items"][number];
export type TopArtist = z.infer<typeof topArtistSchema>;
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run test/spotify/errors.test.ts test/spotify/schema.test.ts`
Expected: PASS, 17 tests.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/spotify/limits.ts src/spotify/errors.ts src/spotify/schema.ts test/spotify/errors.test.ts test/spotify/schema.test.ts
git commit -m "Validate Spotify responses at the boundary

Schemas for every Web API answer the library sync reads, in the February
2026 shape where playlist entries carry item rather than track. Errors are
classified the way a sync run has to treat them: a 429 stops everyone, a
revoked grant asks the user to reconnect, anything else is that user's."
git push
```

---

### Task 3: Mapping and sync decisions

**Files:**
- Create: `src/spotify/map.ts`, `src/spotify/diff.ts`
- Test: `test/spotify/map.test.ts`, `test/spotify/diff.test.ts`

**Interfaces:**
- Consumes: `SpotifyTrack`, `PlaylistSummary`, `TopArtist` from `src/spotify/schema.ts`; `RECENTLY_PLAYED_LIMIT` from `src/spotify/limits.ts`
- Produces (`map.ts`):
  - `interface SongRow { source: "spotify"; source_id: string; isrc: string | null; title: string; artists: string[]; album: string | null; duration_ms: number | null; artwork_url: string | null }`
  - `toSongRow(track: SpotifyTrack): SongRow | null`
  - `uniqueSongRows(rows: readonly SongRow[]): SongRow[]`
  - `interface PlaylistMeta { source: "spotify"; source_id: string; name: string; description: string | null; artwork_url: string | null }`
  - `toPlaylistMeta(p: PlaylistSummary): PlaylistMeta`
  - `interface TasteArtist { id: string; name: string; genres: string[]; imageUrl: string | null }`, `toTasteArtist(a: TopArtist): TasteArtist`
  - `interface TasteTrack { sourceId: string; title: string; artists: string[] }`, `toTasteTrack(row: SongRow): TasteTrack`
- Produces (`diff.ts`):
  - `freshLikes<T extends { added_at: string }>(items: readonly T[], newestKnown: string | null): { fresh: T[]; done: boolean }`
  - `likesToRemove(stored: readonly string[], seen: ReadonlySet<string>): string[]`
  - `interface StoredPlaylist { sourceId: string; snapshotId: string | null }`
  - `planPlaylists(remote: readonly PlaylistSummary[], stored: readonly StoredPlaylist[], spotifyUserId: string): { mine: PlaylistSummary[]; refresh: PlaylistSummary[]; remove: string[] }`
  - `advanceCursor(playedAt: readonly string[], previous: string | null): string | null`
  - `recentGap(playedAt: readonly string[], previous: string | null): { from: string; to: string } | null`
  - `tokenNeedsRefresh(expiresAt: string | null, now: Date, marginMs?: number): boolean`
  - `dailyPassDue(lastDaily: string | null, now: Date): boolean`
  - `syncNowAllowed(lastSyncedAt: string | null, now: Date, minIntervalMs?: number): boolean`

- [ ] **Step 1: Write the failing tests**

Create `test/spotify/map.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  toPlaylistMeta,
  toSongRow,
  toTasteArtist,
  toTasteTrack,
  uniqueSongRows,
  type SongRow,
} from "../../src/spotify/map";
import type { SpotifyTrack } from "../../src/spotify/schema";

const track: SpotifyTrack = {
  type: "track",
  id: "t1",
  name: "Glory Box",
  duration_ms: 305_000,
  is_local: false,
  artists: [{ name: "Portishead" }, { name: " Guest " }],
  album: { name: "Dummy", images: [{ url: "big" }, { url: "small" }] },
  external_ids: { isrc: "GBBKS9400010" },
};

describe("toSongRow", () => {
  it("maps a track, keeping every artist in order and the largest art", () => {
    expect(toSongRow(track)).toEqual({
      source: "spotify",
      source_id: "t1",
      isrc: "GBBKS9400010",
      title: "Glory Box",
      artists: ["Portishead", "Guest"],
      album: "Dummy",
      duration_ms: 305_000,
      artwork_url: "big",
    });
  });

  it("fills what Spotify left out with null", () => {
    const bare: SpotifyTrack = { type: "track", id: "t2", name: "X", artists: [{ name: "A" }] };
    expect(toSongRow(bare)).toMatchObject({
      isrc: null,
      album: null,
      duration_ms: null,
      artwork_url: null,
    });
  });

  it("skips local files, episodes and tracks with no artist", () => {
    expect(toSongRow({ ...track, id: null, is_local: true })).toBeNull();
    expect(toSongRow({ ...track, is_local: true })).toBeNull();
    expect(toSongRow({ type: "episode", id: "e1", name: "Pod" })).toBeNull();
    expect(toSongRow({ ...track, artists: [] })).toBeNull();
    expect(toSongRow({ ...track, artists: [{ name: "  " }] })).toBeNull();
  });
});

describe("uniqueSongRows", () => {
  it("keeps the first row for each Spotify id", () => {
    const a = toSongRow(track) as SongRow;
    const again = { ...a, title: "Glory Box (again)" };
    const b = { ...a, source_id: "t2" };
    expect(uniqueSongRows([a, again, b])).toEqual([a, b]);
  });
});

describe("toPlaylistMeta", () => {
  it("keeps name, description and the first image", () => {
    expect(
      toPlaylistMeta({
        id: "pl1",
        name: "Late",
        description: "",
        collaborative: false,
        owner: { id: "me" },
        snapshot_id: "s1",
        images: [{ url: "cover" }],
      }),
    ).toEqual({
      source: "spotify",
      source_id: "pl1",
      name: "Late",
      description: null,
      artwork_url: "cover",
    });
  });
});

describe("taste items", () => {
  it("maps an artist", () => {
    expect(toTasteArtist({ id: "ar1", name: "Portishead", images: null })).toEqual({
      id: "ar1",
      name: "Portishead",
      genres: [],
      imageUrl: null,
    });
  });

  it("maps a song row to a track item", () => {
    expect(toTasteTrack(toSongRow(track) as SongRow)).toEqual({
      sourceId: "t1",
      title: "Glory Box",
      artists: ["Portishead", "Guest"],
    });
  });
});
```

Create `test/spotify/diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  advanceCursor,
  dailyPassDue,
  freshLikes,
  likesToRemove,
  planPlaylists,
  recentGap,
  syncNowAllowed,
  tokenNeedsRefresh,
} from "../../src/spotify/diff";
import type { PlaylistSummary } from "../../src/spotify/schema";

const like = (added_at: string) => ({ added_at });

describe("freshLikes", () => {
  it("takes everything when nothing is stored yet", () => {
    const items = [like("2026-09-22T00:00:00Z"), like("2026-09-10T00:00:00Z")];
    expect(freshLikes(items, null)).toEqual({ fresh: items, done: false });
  });

  it("stops at the first like older than the newest stored", () => {
    const items = [
      like("2026-09-22T00:00:00Z"),
      like("2026-09-20T00:00:00Z"),
      like("2026-09-10T00:00:00Z"),
    ];
    expect(freshLikes(items, "2026-09-20T00:00:00Z")).toEqual({
      fresh: [items[0], items[1]],
      done: true,
    });
  });

  it("keeps going when the whole page is newer", () => {
    const items = [like("2026-09-22T00:00:00Z")];
    expect(freshLikes(items, "2026-09-01T00:00:00Z")).toEqual({ fresh: items, done: false });
  });
});

describe("likesToRemove", () => {
  it("lists stored likes the full pass didn't see", () => {
    expect(likesToRemove(["a", "b", "c"], new Set(["a", "c"]))).toEqual(["b"]);
  });
});

function playlist(id: string, owner: string, snapshot: string, collaborative = false): PlaylistSummary {
  return { id, name: id, collaborative, owner: { id: owner }, snapshot_id: snapshot };
}

describe("planPlaylists", () => {
  it("keeps owned and collaborative playlists and ignores followed ones", () => {
    const remote = [
      playlist("mine", "me", "s1"),
      playlist("collab", "friend", "s1", true),
      playlist("followed", "friend", "s1"),
    ];
    const plan = planPlaylists(remote, [], "me");
    expect(plan.mine.map((p) => p.id)).toEqual(["mine", "collab"]);
    expect(plan.refresh.map((p) => p.id)).toEqual(["mine", "collab"]);
    expect(plan.remove).toEqual([]);
  });

  it("re-reads only playlists whose snapshot changed, or never finished", () => {
    const remote = [
      playlist("same", "me", "s1"),
      playlist("changed", "me", "s2"),
      playlist("unfinished", "me", "s1"),
    ];
    const stored = [
      { sourceId: "same", snapshotId: "s1" },
      { sourceId: "changed", snapshotId: "s1" },
      { sourceId: "unfinished", snapshotId: null },
    ];
    expect(planPlaylists(remote, stored, "me").refresh.map((p) => p.id)).toEqual([
      "changed",
      "unfinished",
    ]);
  });

  it("removes stored playlists that are gone or no longer yours", () => {
    const remote = [playlist("kept", "me", "s1"), playlist("given-away", "friend", "s1")];
    const stored = [
      { sourceId: "kept", snapshotId: "s1" },
      { sourceId: "deleted", snapshotId: "s1" },
      { sourceId: "given-away", snapshotId: "s1" },
    ];
    expect(planPlaylists(remote, stored, "me").remove).toEqual(["deleted", "given-away"]);
  });
});

describe("advanceCursor", () => {
  it("moves to the newest play", () => {
    expect(
      advanceCursor(["2026-09-25T10:00:00.000Z", "2026-09-25T11:00:00.000Z"], null),
    ).toBe("2026-09-25T11:00:00.000Z");
  });

  it("never moves backwards, and stays put with no plays", () => {
    expect(advanceCursor(["2026-09-25T09:00:00.000Z"], "2026-09-25T10:00:00.000Z")).toBe(
      "2026-09-25T10:00:00.000Z",
    );
    expect(advanceCursor([], "2026-09-25T10:00:00.000Z")).toBe("2026-09-25T10:00:00.000Z");
    expect(advanceCursor([], null)).toBeNull();
  });
});

describe("recentGap", () => {
  const minutes = (n: number) => new Date(Date.parse("2026-09-25T10:00:00.000Z") + n * 60_000).toISOString();
  const fullPage = Array.from({ length: 50 }, (_, i) => minutes(10 + i));

  it("flags a full page that is all newer than the cursor", () => {
    expect(recentGap(fullPage, minutes(0))).toEqual({ from: minutes(0), to: minutes(10) });
  });

  it("is quiet for a short page, a first sync, or a page reaching the cursor", () => {
    expect(recentGap(fullPage.slice(0, 49), minutes(0))).toBeNull();
    expect(recentGap(fullPage, null)).toBeNull();
    expect(recentGap(fullPage, minutes(10))).toBeNull();
  });
});

describe("timing", () => {
  const now = new Date("2026-09-25T12:00:00Z");

  it("refreshes a token with a minute or less left, or none known", () => {
    expect(tokenNeedsRefresh("2026-09-25T12:00:30Z", now)).toBe(true);
    expect(tokenNeedsRefresh("2026-09-25T12:01:00Z", now)).toBe(true);
    expect(tokenNeedsRefresh("2026-09-25T12:05:00Z", now)).toBe(false);
    expect(tokenNeedsRefresh(null, now)).toBe(true);
  });

  it("runs the daily pass after 24 hours, or if it never ran", () => {
    expect(dailyPassDue(null, now)).toBe(true);
    expect(dailyPassDue("2026-09-24T12:00:00Z", now)).toBe(true);
    expect(dailyPassDue("2026-09-24T12:00:01Z", now)).toBe(false);
  });

  it("allows Sync now once a minute", () => {
    expect(syncNowAllowed(null, now)).toBe(true);
    expect(syncNowAllowed("2026-09-25T11:59:00Z", now)).toBe(true);
    expect(syncNowAllowed("2026-09-25T11:59:30Z", now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx vitest run test/spotify/map.test.ts test/spotify/diff.test.ts`
Expected: FAIL, "Failed to resolve import ../../src/spotify/map" (and `diff`).

- [ ] **Step 3: Write the implementation**

Create `src/spotify/map.ts`:

```ts
import type { PlaylistSummary, SpotifyTrack, TopArtist } from "./schema";

/** A `songs` row as the sync writes it. The match columns are left out on
 *  purpose: an upsert must never reset a song that has already been matched. */
export interface SongRow {
  source: "spotify";
  source_id: string;
  isrc: string | null;
  title: string;
  artists: string[];
  album: string | null;
  duration_ms: number | null;
  artwork_url: string | null;
}

/**
 * A Spotify track as a song, or null for what june can't use: local files
 * (no Spotify id), podcast episodes, and anything without an artist to match
 * on. Spotify lists album art largest first.
 */
export function toSongRow(track: SpotifyTrack): SongRow | null {
  if (track.type !== "track" || track.is_local === true || !track.id) return null;
  const artists = (track.artists ?? [])
    .map((artist) => artist.name.trim())
    .filter((name) => name.length > 0);
  if (artists.length === 0) return null;
  return {
    source: "spotify",
    source_id: track.id,
    isrc: track.external_ids?.isrc ?? null,
    title: track.name,
    artists,
    album: track.album?.name ?? null,
    duration_ms: track.duration_ms ?? null,
    artwork_url: track.album?.images?.[0]?.url ?? null,
  };
}

/** One row per Spotify id, first occurrence wins. A playlist can hold the same
 *  track twice, and Postgres refuses an upsert that touches a row twice. */
export function uniqueSongRows(rows: readonly SongRow[]): SongRow[] {
  const seen = new Set<string>();
  const out: SongRow[] = [];
  for (const row of rows) {
    if (seen.has(row.source_id)) continue;
    seen.add(row.source_id);
    out.push(row);
  }
  return out;
}

export interface PlaylistMeta {
  source: "spotify";
  source_id: string;
  name: string;
  description: string | null;
  artwork_url: string | null;
}

export function toPlaylistMeta(playlist: PlaylistSummary): PlaylistMeta {
  return {
    source: "spotify",
    source_id: playlist.id,
    name: playlist.name,
    description: playlist.description ? playlist.description : null,
    artwork_url: playlist.images?.[0]?.url ?? null,
  };
}

export interface TasteArtist {
  id: string;
  name: string;
  genres: string[];
  imageUrl: string | null;
}

export function toTasteArtist(artist: TopArtist): TasteArtist {
  return {
    id: artist.id,
    name: artist.name,
    genres: artist.genres ?? [],
    imageUrl: artist.images?.[0]?.url ?? null,
  };
}

export interface TasteTrack {
  sourceId: string;
  title: string;
  artists: string[];
}

export function toTasteTrack(row: SongRow): TasteTrack {
  return { sourceId: row.source_id, title: row.title, artists: row.artists };
}
```

Create `src/spotify/diff.ts`:

```ts
import { RECENTLY_PLAYED_LIMIT } from "./limits";
import type { PlaylistSummary } from "./schema";

/**
 * Liked songs arrive newest first. Everything at or after the newest like
 * already stored is kept; the first one strictly older means the rest are
 * stored too. Equal timestamps are kept rather than skipped (the upsert
 * ignores duplicates), so two likes in the same second can't hide each other.
 */
export function freshLikes<T extends { added_at: string }>(
  items: readonly T[],
  newestKnown: string | null,
): { fresh: T[]; done: boolean } {
  if (newestKnown === null) return { fresh: [...items], done: false };
  const cutoff = Date.parse(newestKnown);
  const fresh: T[] = [];
  for (const item of items) {
    if (Date.parse(item.added_at) < cutoff) return { fresh, done: true };
    fresh.push(item);
  }
  return { fresh, done: false };
}

/** Stored likes the daily full pass didn't see: the user unliked them. */
export function likesToRemove(stored: readonly string[], seen: ReadonlySet<string>): string[] {
  return stored.filter((songId) => !seen.has(songId));
}

export interface StoredPlaylist {
  sourceId: string;
  snapshotId: string | null;
}

/**
 * Which playlists to keep, re-read and forget. Only owned and collaborative
 * playlists count: Development Mode returns no songs for anyone else's. A
 * playlist is re-read when its snapshot differs from the one stored, which
 * includes one whose songs were never finished (stored snapshot null).
 */
export function planPlaylists(
  remote: readonly PlaylistSummary[],
  stored: readonly StoredPlaylist[],
  spotifyUserId: string,
): { mine: PlaylistSummary[]; refresh: PlaylistSummary[]; remove: string[] } {
  const mine = remote.filter((p) => p.owner.id === spotifyUserId || p.collaborative);
  const storedSnapshots = new Map(stored.map((p) => [p.sourceId, p.snapshotId]));
  const refresh = mine.filter((p) => storedSnapshots.get(p.sourceId) !== p.snapshot_id);
  const keep = new Set(mine.map((p) => p.id));
  const remove = stored.filter((p) => !keep.has(p.sourceId)).map((p) => p.sourceId);
  return { mine, refresh, remove };
}

/** The newest play seen so far. Never moves backwards. */
export function advanceCursor(playedAt: readonly string[], previous: string | null): string | null {
  let newest = previous === null ? null : Date.parse(previous);
  for (const at of playedAt) {
    const time = Date.parse(at);
    if (newest === null || time > newest) newest = time;
  }
  return newest === null ? null : new Date(newest).toISOString();
}

/**
 * Spotify keeps only the last 50 plays. A full page whose oldest play is
 * still newer than the cursor means plays in between were lost; this names
 * the window so the run can log it.
 */
export function recentGap(
  playedAt: readonly string[],
  previous: string | null,
): { from: string; to: string } | null {
  if (previous === null || playedAt.length < RECENTLY_PLAYED_LIMIT) return null;
  const oldest = Math.min(...playedAt.map((at) => Date.parse(at)));
  if (oldest <= Date.parse(previous)) return null;
  return { from: previous, to: new Date(oldest).toISOString() };
}

export function tokenNeedsRefresh(
  expiresAt: string | null,
  now: Date,
  marginMs = 60_000,
): boolean {
  if (expiresAt === null) return true;
  return Date.parse(expiresAt) - now.getTime() <= marginMs;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The daily pass re-reads every like (to catch unlikes) and the top lists. */
export function dailyPassDue(lastDaily: string | null, now: Date): boolean {
  return lastDaily === null || now.getTime() - Date.parse(lastDaily) >= DAY_MS;
}

export function syncNowAllowed(
  lastSyncedAt: string | null,
  now: Date,
  minIntervalMs = 60_000,
): boolean {
  return lastSyncedAt === null || now.getTime() - Date.parse(lastSyncedAt) >= minIntervalMs;
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run test/spotify/map.test.ts test/spotify/diff.test.ts`
Expected: PASS, 21 tests.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/spotify/map.ts src/spotify/diff.ts test/spotify/map.test.ts test/spotify/diff.test.ts
git commit -m "Decide what a Spotify sync stores, as pure functions

Tracks become shared song rows (local files and episodes are skipped), and
every sync decision is testable without Spotify: which likes are new, which
were removed, which playlists changed, how far the listen cursor moves, and
when plays may have been lost past Spotify's 50-play window."
git push
```

---

### Task 4: OAuth helpers

**Files:**
- Create: `src/spotify/oauth.ts`
- Test: `test/spotify/oauth.test.ts`

**Interfaces:**
- Consumes: `tokenResponseSchema` (Task 2), `SpotifyAuthError` (Task 2)
- Produces:
  - `SPOTIFY_SCOPES: readonly string[]`
  - `interface SpotifyOAuthConfig { clientId: string; clientSecret: string }`
  - `interface TokenSet { accessToken: string; refreshToken: string | null; expiresAt: Date }`
  - `interface OAuthDeps { fetch?: (input: string, init?: RequestInit) => Promise<Response>; now?: () => Date }`
  - `authorizeUrl(args: { clientId: string; redirectUri: string; state: string }): string`
  - `exchangeCode(code: string, redirectUri: string, config: SpotifyOAuthConfig, deps?: OAuthDeps): Promise<TokenSet>`
  - `refreshTokens(refreshToken: string, config: SpotifyOAuthConfig, deps?: OAuthDeps): Promise<TokenSet>`
  - `stateCookieValue(userId: string, nonce: string): string`
  - `stateMatches(cookie: string | undefined, returned: string | null, userId: string): boolean`

- [ ] **Step 1: Write the failing test**

Create `test/spotify/oauth.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  authorizeUrl,
  exchangeCode,
  refreshTokens,
  SPOTIFY_SCOPES,
  stateCookieValue,
  stateMatches,
} from "../../src/spotify/oauth";

const config = { clientId: "cid", clientSecret: "secret" };
const now = () => new Date("2026-09-25T12:00:00Z");
const REDIRECT = "http://127.0.0.1:3000/api/spotify/callback";

function tokenFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

describe("authorizeUrl", () => {
  it("asks for a code, every scope, and carries the state", () => {
    const url = new URL(authorizeUrl({ clientId: "cid", redirectUri: REDIRECT, state: "nonce" }));
    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.spotify.com/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("nonce");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...SPOTIFY_SCOPES]);
  });
});

describe("exchangeCode", () => {
  it("posts the code with basic auth and says when the token expires", async () => {
    const { fetch, calls } = tokenFetch(200, {
      access_token: "at",
      expires_in: 3600,
      refresh_token: "rt",
    });
    const tokens = await exchangeCode("code1", REDIRECT, config, { fetch, now });

    expect(tokens).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: new Date("2026-09-25T13:00:00Z"),
    });
    expect(calls[0]!.url).toBe("https://accounts.spotify.com/api/token");
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa("cid:secret")}`);
    const body = new URLSearchParams(calls[0]!.init!.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code1");
    expect(body.get("redirect_uri")).toBe(REDIRECT);
  });
});

describe("refreshTokens", () => {
  it("returns no refresh token when Spotify keeps the old one", async () => {
    const { fetch, calls } = tokenFetch(200, { access_token: "at2", expires_in: 3600 });
    const tokens = await refreshTokens("rt", config, { fetch, now });

    expect(tokens.refreshToken).toBeNull();
    expect(tokens.accessToken).toBe("at2");
    const body = new URLSearchParams(calls[0]!.init!.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt");
  });

  it("returns the rotated refresh token when there is one", async () => {
    const { fetch } = tokenFetch(200, { access_token: "at2", expires_in: 3600, refresh_token: "rt2" });
    expect((await refreshTokens("rt", config, { fetch, now })).refreshToken).toBe("rt2");
  });

  it("turns a revoked grant into SpotifyAuthError('invalid_grant')", async () => {
    const { fetch } = tokenFetch(400, {
      error: "invalid_grant",
      error_description: "Refresh token revoked",
    });
    await expect(refreshTokens("rt", config, { fetch, now })).rejects.toMatchObject({
      name: "SpotifyAuthError",
      code: "invalid_grant",
    });
  });

  it("refuses to run without a client id and secret", async () => {
    await expect(refreshTokens("rt", { clientId: "", clientSecret: "" })).rejects.toThrow(
      /not configured/i,
    );
  });
});

describe("state", () => {
  it("matches only the same nonce for the same user", () => {
    const cookie = stateCookieValue("user-1", "nonce");
    expect(stateMatches(cookie, "nonce", "user-1")).toBe(true);
    expect(stateMatches(cookie, "other", "user-1")).toBe(false);
    expect(stateMatches(cookie, "nonce", "user-2")).toBe(false);
    expect(stateMatches(undefined, "nonce", "user-1")).toBe(false);
    expect(stateMatches(cookie, null, "user-1")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/spotify/oauth.test.ts`
Expected: FAIL, "Failed to resolve import ../../src/spotify/oauth".

- [ ] **Step 3: Write the implementation**

Create `src/spotify/oauth.ts`:

```ts
import { SpotifyAuthError } from "./errors";
import { tokenResponseSchema } from "./schema";

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

/** Everything june reads. All read-only. */
export const SPOTIFY_SCOPES: readonly string[] = [
  "user-library-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-top-read",
  "user-read-recently-played",
];

export interface SpotifyOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface TokenSet {
  accessToken: string;
  /** Null on a refresh where Spotify kept the existing refresh token. */
  refreshToken: string | null;
  expiresAt: Date;
}

export interface OAuthDeps {
  /** Injectable for tests; defaults to global fetch. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => Date;
}

export function authorizeUrl({
  clientId,
  redirectUri,
  state,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", SPOTIFY_SCOPES.join(" "));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * One call to Spotify's token endpoint. Fails loud: missing config, a refused
 * request (with Spotify's own error code, so a revoked grant is recognisable)
 * and an unexpected shape all throw.
 */
async function requestTokens(
  params: URLSearchParams,
  config: SpotifyOAuthConfig,
  deps: OAuthDeps,
): Promise<TokenSet> {
  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      "Spotify is not configured (set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET).",
    );
  }
  const doFetch = deps.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const now = deps.now ?? (() => new Date());

  const response = await doFetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      error_description?: string;
    } | null;
    const code = body?.error ?? `http_${response.status}`;
    throw new SpotifyAuthError(
      code,
      `Spotify token request failed (${response.status}): ${body?.error_description ?? code}`,
    );
  }

  const tokens = tokenResponseSchema.parse(await response.json());
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: new Date(now().getTime() + tokens.expires_in * 1000),
  };
}

export function exchangeCode(
  code: string,
  redirectUri: string,
  config: SpotifyOAuthConfig,
  deps: OAuthDeps = {},
): Promise<TokenSet> {
  return requestTokens(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    config,
    deps,
  );
}

export function refreshTokens(
  refreshToken: string,
  config: SpotifyOAuthConfig,
  deps: OAuthDeps = {},
): Promise<TokenSet> {
  return requestTokens(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    config,
    deps,
  );
}

/** The state cookie names whose connect this is as well as the nonce Spotify
 *  must hand back, so a callback started in one june session can't complete
 *  in another's. */
export function stateCookieValue(userId: string, nonce: string): string {
  return `${userId}.${nonce}`;
}

export function stateMatches(
  cookie: string | undefined,
  returned: string | null,
  userId: string,
): boolean {
  if (!cookie || !returned) return false;
  return cookie === stateCookieValue(userId, returned);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/spotify/oauth.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/spotify/oauth.ts test/spotify/oauth.test.ts
git commit -m "Add Spotify's authorization code flow

Builds the authorize URL with june's read-only scopes, exchanges and
refreshes tokens with the client secret kept server-side, and keeps
Spotify's error code on a refusal so a revoked grant can be told apart. The
state cookie binds the nonce to the june user who started the connect."
git push
```

---

### Task 5: Web API client

**Files:**
- Create: `src/spotify/client.ts`
- Test: `test/spotify/client.test.ts`

**Interfaces:**
- Consumes: schemas and types (Task 2), `SPOTIFY_PAGE_SIZE`, `RECENTLY_PLAYED_LIMIT`, `TimeRange` (Task 2), `SpotifyApiError` (Task 2)
- Produces:
  - `interface SpotifyClient { me(): Promise<SpotifyMe>; recentlyPlayed(afterMs: number | null): Promise<RecentlyPlayedItem[]>; savedTracks(offset: number): Promise<SavedTracksPage>; myPlaylists(): Promise<PlaylistSummary[]>; playlistItems(playlistId: string): Promise<PlaylistItem[]>; topArtists(range: TimeRange): Promise<TopArtist[]>; topTracks(range: TimeRange): Promise<SpotifyTrack[]> }`
  - `createSpotifyClient(config: { accessToken: string; fetch?: (input: URL, init?: RequestInit) => Promise<Response>; baseUrl?: string }): SpotifyClient`

- [ ] **Step 1: Write the failing test**

Create `test/spotify/client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createSpotifyClient } from "../../src/spotify/client";
import { SpotifyApiError } from "../../src/spotify/errors";

type Reply = { status?: number; body: unknown; headers?: Record<string, string> };

/** Records requested URLs and answers per handler, like test/youtube/client.test.ts. */
function stubFetch(handler: (url: URL) => Reply) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetch = async (url: URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const { status = 200, body, headers = {} } = handler(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  };
  return { fetch, calls };
}

const track = (id: string) => ({ type: "track", id, name: `T${id}`, artists: [{ name: "A" }] });
const playlistJson = (id: string) => ({
  id,
  name: id,
  collaborative: false,
  owner: { id: "me" },
  snapshot_id: "s",
});

describe("createSpotifyClient", () => {
  it("requires an access token", () => {
    expect(() => createSpotifyClient({ accessToken: "" })).toThrow(/accessToken is required/);
  });

  it("sends the bearer token and reads the current user", async () => {
    const { fetch, calls } = stubFetch(() => ({ body: { id: "me", display_name: "Me" } }));
    const me = await createSpotifyClient({ accessToken: "tok", fetch }).me();

    expect(me).toEqual({ id: "me", display_name: "Me" });
    expect(calls[0]!.url.toString()).toBe("https://api.spotify.com/v1/me");
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("asks for plays after the cursor, 50 at a time", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: { items: [{ track: track("a"), played_at: "2026-09-25T11:00:00.000Z" }] },
    }));
    const client = createSpotifyClient({ accessToken: "tok", fetch });

    const items = await client.recentlyPlayed(1_758_000_000_000);
    expect(items).toHaveLength(1);
    expect(calls[0]!.url.pathname).toBe("/v1/me/player/recently-played");
    expect(calls[0]!.url.searchParams.get("after")).toBe("1758000000000");
    expect(calls[0]!.url.searchParams.get("limit")).toBe("50");

    await client.recentlyPlayed(null);
    expect(calls[1]!.url.searchParams.has("after")).toBe(false);
  });

  it("reads one page of saved tracks at the offset given", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: { items: [{ added_at: "2026-09-20T00:00:00Z", track: track("a") }], next: null },
    }));
    const page = await createSpotifyClient({ accessToken: "tok", fetch }).savedTracks(100);

    expect(page.next).toBeNull();
    expect(calls[0]!.url.pathname).toBe("/v1/me/tracks");
    expect(calls[0]!.url.searchParams.get("offset")).toBe("100");
    expect(calls[0]!.url.searchParams.get("limit")).toBe("50");
  });

  it("follows playlist pages until next is null", async () => {
    const { fetch, calls } = stubFetch((url) =>
      url.searchParams.get("offset") === "0"
        ? { body: { items: [playlistJson("p1")], next: "https://api.spotify.com/v1/me/playlists?offset=50" } }
        : { body: { items: [playlistJson("p2")], next: null } },
    );
    const playlists = await createSpotifyClient({ accessToken: "tok", fetch }).myPlaylists();

    expect(playlists.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(calls.map((c) => c.url.searchParams.get("offset"))).toEqual(["0", "50"]);
  });

  it("reads a playlist's entries from /items", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: { items: [{ added_at: null, item: track("a") }], next: null },
    }));
    const items = await createSpotifyClient({ accessToken: "tok", fetch }).playlistItems("pl 1");

    expect(items[0]?.item?.id).toBe("a");
    expect(calls[0]!.url.pathname).toBe("/v1/playlists/pl%201/items");
  });

  it("asks for top items by time range", async () => {
    const { fetch, calls } = stubFetch((url) =>
      url.pathname.endsWith("/artists")
        ? { body: { items: [{ id: "ar1", name: "Portishead" }] } }
        : { body: { items: [track("a")] } },
    );
    const client = createSpotifyClient({ accessToken: "tok", fetch });

    expect((await client.topArtists("short_term"))[0]?.name).toBe("Portishead");
    expect((await client.topTracks("long_term"))[0]?.id).toBe("a");
    expect(calls[0]!.url.searchParams.get("time_range")).toBe("short_term");
    expect(calls[1]!.url.pathname).toBe("/v1/me/top/tracks");
    expect(calls[1]!.url.searchParams.get("limit")).toBe("50");
  });

  it("throws SpotifyApiError with Retry-After on a 429", async () => {
    const { fetch } = stubFetch(() => ({
      status: 429,
      body: { error: { status: 429, message: "API rate limit exceeded" } },
      headers: { "retry-after": "30" },
    }));
    const error = await createSpotifyClient({ accessToken: "tok", fetch })
      .me()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SpotifyApiError);
    expect(error).toMatchObject({ status: 429, retryAfterSeconds: 30 });
    expect((error as Error).message).toMatch(/API rate limit exceeded/);
  });

  it("keeps Spotify's message on other errors", async () => {
    const { fetch } = stubFetch(() => ({
      status: 403,
      body: { error: { status: 403, message: "User not registered in the Developer Dashboard" } },
    }));
    await expect(createSpotifyClient({ accessToken: "tok", fetch }).me()).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(/not registered/),
    });
  });

  it("fails on a shape it doesn't expect", async () => {
    const { fetch } = stubFetch(() => ({ body: { nope: true } }));
    await expect(createSpotifyClient({ accessToken: "tok", fetch }).me()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/spotify/client.test.ts`
Expected: FAIL, "Failed to resolve import ../../src/spotify/client".

- [ ] **Step 3: Write the implementation**

Create `src/spotify/client.ts`:

```ts
import { SpotifyApiError } from "./errors";
import { RECENTLY_PLAYED_LIMIT, SPOTIFY_PAGE_SIZE, type TimeRange } from "./limits";
import {
  meSchema,
  playlistItemsPageSchema,
  playlistsPageSchema,
  recentlyPlayedSchema,
  savedTracksPageSchema,
  topArtistsSchema,
  topTracksSchema,
  type PlaylistItem,
  type PlaylistSummary,
  type RecentlyPlayedItem,
  type SavedTracksPage,
  type SpotifyMe,
  type SpotifyTrack,
  type TopArtist,
} from "./schema";

const DEFAULT_BASE_URL = "https://api.spotify.com/v1";
/** 20,000 entries. Far past any real playlist; hitting it means paging broke. */
const MAX_PAGES = 400;

/** The slice of the Web API the library sync needs. */
export interface SpotifyClient {
  me(): Promise<SpotifyMe>;
  /** Plays after `afterMs` (exclusive), or the latest 50 when null. */
  recentlyPlayed(afterMs: number | null): Promise<RecentlyPlayedItem[]>;
  /** One page of liked songs, newest first. The caller decides when to stop. */
  savedTracks(offset: number): Promise<SavedTracksPage>;
  /** Every playlist in the user's library, all pages. */
  myPlaylists(): Promise<PlaylistSummary[]>;
  /** Every entry of a playlist the user owns or collaborates on, all pages. */
  playlistItems(playlistId: string): Promise<PlaylistItem[]>;
  topArtists(range: TimeRange): Promise<TopArtist[]>;
  topTracks(range: TimeRange): Promise<SpotifyTrack[]>;
}

type FetchLike = (input: URL, init?: RequestInit) => Promise<Response>;

export interface SpotifyClientConfig {
  accessToken: string;
  /** Defaults to the global `fetch`; pass a stub in tests. */
  fetch?: FetchLike;
  baseUrl?: string;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } | string };
    if (body.error && typeof body.error === "object" && body.error.message) return body.error.message;
    return JSON.stringify(body);
  } catch {
    return response.statusText || "unknown error";
  }
}

function retryAfterSeconds(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (raw === null) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function createSpotifyClient(config: SpotifyClientConfig): SpotifyClient {
  if (!config.accessToken) throw new Error("createSpotifyClient: accessToken is required");
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const doFetch: FetchLike = config.fetch ?? ((url, init) => fetch(url, init));

  async function get(path: string, params: Record<string, string> = {}): Promise<unknown> {
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await doFetch(url, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
    });
    if (!response.ok) {
      const retry = response.status === 429 ? retryAfterSeconds(response) : null;
      throw new SpotifyApiError(
        response.status,
        `Spotify API ${response.status} on ${path}: ${await errorMessage(response)}`,
        retry,
      );
    }
    return response.json();
  }

  async function allPages<T>(
    path: string,
    parse: (json: unknown) => { items: T[]; next: string | null },
  ): Promise<T[]> {
    const all: T[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { items, next } = parse(
        await get(path, { limit: String(SPOTIFY_PAGE_SIZE), offset: String(page * SPOTIFY_PAGE_SIZE) }),
      );
      all.push(...items);
      if (next === null) return all;
    }
    throw new Error(`Spotify API: ${path} was still paging after ${MAX_PAGES} pages`);
  }

  return {
    async me() {
      return meSchema.parse(await get("/me"));
    },

    async recentlyPlayed(afterMs) {
      const params: Record<string, string> = { limit: String(RECENTLY_PLAYED_LIMIT) };
      if (afterMs !== null) params.after = String(afterMs);
      return recentlyPlayedSchema.parse(await get("/me/player/recently-played", params)).items;
    },

    async savedTracks(offset) {
      return savedTracksPageSchema.parse(
        await get("/me/tracks", { limit: String(SPOTIFY_PAGE_SIZE), offset: String(offset) }),
      );
    },

    async myPlaylists() {
      return allPages("/me/playlists", (json) => playlistsPageSchema.parse(json));
    },

    async playlistItems(playlistId) {
      if (!playlistId) throw new Error("playlistItems: playlistId is required");
      return allPages(`/playlists/${encodeURIComponent(playlistId)}/items`, (json) =>
        playlistItemsPageSchema.parse(json),
      );
    },

    async topArtists(range) {
      return topArtistsSchema.parse(
        await get("/me/top/artists", { time_range: range, limit: String(SPOTIFY_PAGE_SIZE) }),
      ).items;
    },

    async topTracks(range) {
      return topTracksSchema.parse(
        await get("/me/top/tracks", { time_range: range, limit: String(SPOTIFY_PAGE_SIZE) }),
      ).items;
    },
  };
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/spotify/client.test.ts`
Expected: PASS, 10 tests.

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/spotify/client.ts test/spotify/client.test.ts
git commit -m "Add a Spotify Web API client for the library sync

Reads the current user, recent plays after a cursor, liked songs a page at a
time, owned playlists and their entries (all pages), and top artists and
tracks. A 429 carries Spotify's Retry-After, and a shape that doesn't parse
throws instead of reaching the sync."
git push
```

---

### Task 6: Sync one user

**Files:**
- Create: `src/lib/spotify/sync-user.ts`
- Test: `test/lib/spotify-sync-user.test.ts`

**Interfaces:**
- Consumes: `SpotifyClient` (Task 5); `toSongRow`, `uniqueSongRows`, `toPlaylistMeta`, `toTasteArtist`, `toTasteTrack`, `SongRow`, `PlaylistMeta`, `TasteArtist`, `TasteTrack` (Task 3); `freshLikes`, `likesToRemove`, `planPlaylists`, `advanceCursor`, `recentGap`, `dailyPassDue`, `StoredPlaylist` (Task 3); `SPOTIFY_PAGE_SIZE`, `TIME_RANGES`, `TimeRange` (Task 2)
- Produces:
  - `type TasteSnapshot = { kind: "artists"; range: TimeRange; items: TasteArtist[] } | { kind: "tracks"; range: TimeRange; items: TasteTrack[] }`
  - `interface LibraryStore` (exact methods below)
  - `interface SyncInput { userId: string; spotifyUserId: string; recentCursor: string | null; lastDailySyncAt: string | null }`
  - `interface SyncOutcome { recentCursor: string | null; dailyDone: boolean; gap: { from: string; to: string } | null }`
  - `syncUser(input: SyncInput, spotify: SpotifyClient, store: LibraryStore, now: Date): Promise<SyncOutcome>`

- [ ] **Step 1: Write the failing test**

Create `test/lib/spotify-sync-user.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  syncUser,
  type LibraryStore,
  type SyncInput,
  type TasteSnapshot,
} from "../../src/lib/spotify/sync-user";
import type { SpotifyClient } from "../../src/spotify/client";
import type { PlaylistMeta, SongRow } from "../../src/spotify/map";
import type {
  PlaylistItem,
  PlaylistSummary,
  RecentlyPlayedItem,
  SavedTracksPage,
  SpotifyTrack,
  TopArtist,
} from "../../src/spotify/schema";

/** An in-memory LibraryStore for one user. */
class FakeStore implements LibraryStore {
  songs = new Map<string, { id: string; row: SongRow }>();
  listens: { songId: string; playedAt: string }[] = [];
  likes = new Map<string, { songId: string; addedAt: string }>();
  playlists = new Map<
    string,
    { id: string; meta: PlaylistMeta; snapshotId: string | null; songs: { songId: string; addedAt: string | null }[] }
  >();
  taste: TasteSnapshot[] = [];
  private next = 0;

  songId(sourceId: string): string {
    const song = this.songs.get(sourceId);
    if (!song) throw new Error(`no song ${sourceId}`);
    return song.id;
  }

  async upsertSongs(rows: SongRow[]) {
    const ids = new Map<string, string>();
    for (const row of rows) {
      const id = this.songs.get(row.source_id)?.id ?? `song-${++this.next}`;
      this.songs.set(row.source_id, { id, row });
      ids.set(row.source_id, id);
    }
    return ids;
  }
  async addListens(_userId: string, listens: { songId: string; playedAt: string }[]) {
    for (const listen of listens) {
      if (!this.listens.some((l) => l.playedAt === listen.playedAt)) this.listens.push(listen);
    }
  }
  async newestLikeAt() {
    let newest: string | null = null;
    for (const like of this.likes.values()) if (newest === null || like.addedAt > newest) newest = like.addedAt;
    return newest;
  }
  async addLikes(_userId: string, likes: { songId: string; addedAt: string }[]) {
    for (const like of likes) if (!this.likes.has(like.songId)) this.likes.set(like.songId, like);
  }
  async likedSongIds() {
    return [...this.likes.keys()];
  }
  async removeLikes(_userId: string, songIds: string[]) {
    for (const id of songIds) this.likes.delete(id);
  }
  async storedPlaylists() {
    return [...this.playlists.entries()].map(([sourceId, p]) => ({ sourceId, snapshotId: p.snapshotId }));
  }
  async upsertPlaylists(_userId: string, metas: PlaylistMeta[]) {
    const ids = new Map<string, string>();
    for (const meta of metas) {
      const existing = this.playlists.get(meta.source_id);
      const id = existing?.id ?? `pl-${++this.next}`;
      this.playlists.set(meta.source_id, {
        id,
        meta,
        snapshotId: existing?.snapshotId ?? null,
        songs: existing?.songs ?? [],
      });
      ids.set(meta.source_id, id);
    }
    return ids;
  }
  async replacePlaylistSongs(
    playlistId: string,
    songs: { songId: string; addedAt: string | null }[],
    snapshotId: string,
  ) {
    for (const playlist of this.playlists.values()) {
      if (playlist.id === playlistId) {
        playlist.songs = songs;
        playlist.snapshotId = snapshotId;
        return;
      }
    }
    throw new Error(`no playlist ${playlistId}`);
  }
  async removePlaylists(_userId: string, sourceIds: string[]) {
    for (const id of sourceIds) this.playlists.delete(id);
  }
  async saveTaste(_userId: string, snapshot: TasteSnapshot) {
    this.taste.push(snapshot);
  }
}

const track = (id: string): SpotifyTrack => ({
  type: "track",
  id,
  name: `Song ${id}`,
  duration_ms: 200_000,
  artists: [{ name: "Artist" }],
});

const playlist = (id: string, owner: string, snapshot = "s1", collaborative = false): PlaylistSummary => ({
  id,
  name: id,
  collaborative,
  owner: { id: owner },
  snapshot_id: snapshot,
});

interface FakeData {
  recent?: RecentlyPlayedItem[];
  likedPages?: SavedTracksPage[];
  playlists?: PlaylistSummary[];
  items?: Record<string, PlaylistItem[]>;
  topArtists?: TopArtist[];
  topTracks?: SpotifyTrack[];
}

function fakeSpotify(data: FakeData) {
  const calls = {
    recentAfter: [] as (number | null)[],
    savedOffsets: [] as number[],
    playlistItems: [] as string[],
    topArtists: 0,
  };
  const client: SpotifyClient = {
    async me() {
      return { id: "me", display_name: "Me" };
    },
    async recentlyPlayed(afterMs) {
      calls.recentAfter.push(afterMs);
      return data.recent ?? [];
    },
    async savedTracks(offset) {
      calls.savedOffsets.push(offset);
      return data.likedPages?.[offset / 50] ?? { items: [], next: null };
    },
    async myPlaylists() {
      return data.playlists ?? [];
    },
    async playlistItems(id) {
      calls.playlistItems.push(id);
      return data.items?.[id] ?? [];
    },
    async topArtists() {
      calls.topArtists++;
      return data.topArtists ?? [];
    },
    async topTracks() {
      return data.topTracks ?? [];
    },
  };
  return { client, calls };
}

const NOW = new Date("2026-09-25T12:00:00.000Z");
const FIRST: SyncInput = { userId: "u1", spotifyUserId: "me", recentCursor: null, lastDailySyncAt: null };
/** A user whose daily pass ran an hour ago, so this run is incremental. */
const LATER: SyncInput = { ...FIRST, lastDailySyncAt: "2026-09-25T11:00:00.000Z" };

describe("syncUser", () => {
  it("stores listens, likes, owned playlists and taste on a first sync", async () => {
    const store = new FakeStore();
    const { client, calls } = fakeSpotify({
      recent: [
        { track: track("a"), played_at: "2026-09-25T11:00:00.000Z" },
        { track: track("b"), played_at: "2026-09-25T10:00:00.000Z" },
      ],
      likedPages: [{ items: [{ added_at: "2026-09-20T00:00:00Z", track: track("c") }], next: null }],
      playlists: [playlist("mine", "me"), playlist("collab", "friend", "s1", true), playlist("followed", "friend")],
      items: {
        mine: [{ added_at: "2026-09-01T00:00:00Z", item: track("d") }],
        collab: [{ added_at: null, item: track("e") }],
      },
      topArtists: [{ id: "ar1", name: "Portishead", genres: ["trip hop"], images: null }],
      topTracks: [track("f")],
    });

    const outcome = await syncUser(FIRST, client, store, NOW);

    expect(store.listens.map((l) => l.playedAt)).toEqual([
      "2026-09-25T11:00:00.000Z",
      "2026-09-25T10:00:00.000Z",
    ]);
    expect([...store.likes.keys()]).toEqual([store.songId("c")]);
    expect([...store.playlists.keys()]).toEqual(["mine", "collab"]);
    expect(calls.playlistItems).toEqual(["mine", "collab"]);
    expect(store.playlists.get("mine")?.songs).toEqual([
      { songId: store.songId("d"), addedAt: "2026-09-01T00:00:00Z" },
    ]);
    expect(store.taste.map((t) => `${t.kind}:${t.range}`)).toEqual([
      "artists:short_term",
      "tracks:short_term",
      "artists:medium_term",
      "tracks:medium_term",
      "artists:long_term",
      "tracks:long_term",
    ]);
    expect(store.songs.has("f")).toBe(true);
    expect(outcome).toEqual({ recentCursor: "2026-09-25T11:00:00.000Z", dailyDone: true, gap: null });
  });

  it("asks Spotify only for plays after the cursor", async () => {
    const { client, calls } = fakeSpotify({});
    await syncUser({ ...LATER, recentCursor: "2026-09-25T10:00:00.000Z" }, client, new FakeStore(), NOW);
    expect(calls.recentAfter).toEqual([Date.parse("2026-09-25T10:00:00.000Z")]);
  });

  it("reads liked songs only back to the newest one already stored", async () => {
    const store = new FakeStore();
    const [oldId] = [...(await store.upsertSongs([{ source: "spotify", source_id: "old", isrc: null, title: "Old", artists: ["A"], album: null, duration_ms: null, artwork_url: null }])).values()];
    await store.addLikes("u1", [{ songId: oldId!, addedAt: "2026-09-20T00:00:00Z" }]);
    const { client, calls } = fakeSpotify({
      likedPages: [
        {
          items: [
            { added_at: "2026-09-22T00:00:00Z", track: track("new") },
            { added_at: "2026-09-20T00:00:00Z", track: track("old") },
            { added_at: "2026-09-10T00:00:00Z", track: track("older") },
          ],
          next: "https://api.spotify.com/v1/me/tracks?offset=50",
        },
      ],
    });

    await syncUser(LATER, client, store, NOW);

    expect(calls.savedOffsets).toEqual([0]);
    expect(store.likes.has(store.songId("new"))).toBe(true);
    expect(store.songs.has("older")).toBe(false);
  });

  it("drops unliked songs on the daily pass", async () => {
    const store = new FakeStore();
    const { client: first } = fakeSpotify({
      likedPages: [
        {
          items: [
            { added_at: "2026-09-22T00:00:00Z", track: track("kept") },
            { added_at: "2026-09-21T00:00:00Z", track: track("unliked") },
          ],
          next: null,
        },
      ],
    });
    await syncUser(FIRST, first, store, NOW);

    const { client: later } = fakeSpotify({
      likedPages: [{ items: [{ added_at: "2026-09-22T00:00:00Z", track: track("kept") }], next: null }],
    });
    await syncUser(FIRST, later, store, NOW);

    expect([...store.likes.keys()]).toEqual([store.songId("kept")]);
  });

  it("re-reads a playlist only when its snapshot changed, and forgets deleted ones", async () => {
    const store = new FakeStore();
    const { client: first } = fakeSpotify({
      playlists: [playlist("same", "me"), playlist("changed", "me"), playlist("gone", "me")],
    });
    await syncUser(LATER, first, store, NOW);

    const { client, calls } = fakeSpotify({
      playlists: [playlist("same", "me", "s1"), playlist("changed", "me", "s2")],
      items: { changed: [{ added_at: null, item: track("x") }] },
    });
    await syncUser(LATER, client, store, NOW);

    expect(calls.playlistItems).toEqual(["changed"]);
    expect([...store.playlists.keys()]).toEqual(["same", "changed"]);
    expect(store.playlists.get("changed")?.snapshotId).toBe("s2");
    expect(store.playlists.get("changed")?.songs).toEqual([{ songId: store.songId("x"), addedAt: null }]);
  });

  it("skips local files, episodes and removed entries inside a playlist", async () => {
    const store = new FakeStore();
    const { client } = fakeSpotify({
      playlists: [playlist("mine", "me")],
      items: {
        mine: [
          { added_at: null, item: { ...track("local"), id: null, is_local: true } },
          { added_at: null, item: { type: "episode", id: "ep", name: "Pod" } },
          { added_at: null, item: null },
          { added_at: null, item: track("real") },
        ],
      },
    });

    await syncUser(LATER, client, store, NOW);

    expect(store.playlists.get("mine")?.songs).toEqual([{ songId: store.songId("real"), addedAt: null }]);
  });

  it("reports a possible gap when a full page of plays is newer than the cursor", async () => {
    const at = (minute: number) =>
      new Date(Date.parse("2026-09-25T10:00:00.000Z") + minute * 60_000).toISOString();
    const recent = Array.from({ length: 50 }, (_, i) => ({ track: track(`r${i}`), played_at: at(59 - i) }));
    const { client } = fakeSpotify({ recent });

    const outcome = await syncUser({ ...LATER, recentCursor: at(0) }, client, new FakeStore(), NOW);

    expect(outcome.gap).toEqual({ from: at(0), to: at(10) });
    expect(outcome.recentCursor).toBe(at(59));
  });

  it("leaves taste alone between daily passes", async () => {
    const store = new FakeStore();
    const { client, calls } = fakeSpotify({ topArtists: [{ id: "ar1", name: "X" }] });

    const outcome = await syncUser(LATER, client, store, NOW);

    expect(calls.topArtists).toBe(0);
    expect(store.taste).toEqual([]);
    expect(outcome.dailyDone).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/lib/spotify-sync-user.test.ts`
Expected: FAIL, "Failed to resolve import ../../src/lib/spotify/sync-user".

- [ ] **Step 3: Write the implementation**

Create `src/lib/spotify/sync-user.ts`:

```ts
import type { SpotifyClient } from "../../spotify/client";
import {
  advanceCursor,
  dailyPassDue,
  freshLikes,
  likesToRemove,
  planPlaylists,
  recentGap,
  type StoredPlaylist,
} from "../../spotify/diff";
import { SPOTIFY_PAGE_SIZE, TIME_RANGES, type TimeRange } from "../../spotify/limits";
import {
  toPlaylistMeta,
  toSongRow,
  toTasteArtist,
  toTasteTrack,
  uniqueSongRows,
  type PlaylistMeta,
  type SongRow,
  type TasteArtist,
  type TasteTrack,
} from "../../spotify/map";
import type { SpotifyTrack } from "../../spotify/schema";

/**
 * One user's sync, written against two interfaces so it can be tested with
 * in-memory fakes. Deliberately free of Supabase and `server-only`: the
 * Supabase-backed store lives in ./store.ts.
 */

export type TasteSnapshot =
  | { kind: "artists"; range: TimeRange; items: TasteArtist[] }
  | { kind: "tracks"; range: TimeRange; items: TasteTrack[] };

export interface LibraryStore {
  /** Insert or refresh songs; returns Spotify id → song uuid for every row. */
  upsertSongs(rows: SongRow[]): Promise<Map<string, string>>;
  /** Ignores plays already stored. */
  addListens(userId: string, listens: { songId: string; playedAt: string }[]): Promise<void>;
  newestLikeAt(userId: string): Promise<string | null>;
  /** Ignores likes already stored. */
  addLikes(userId: string, likes: { songId: string; addedAt: string }[]): Promise<void>;
  likedSongIds(userId: string): Promise<string[]>;
  removeLikes(userId: string, songIds: string[]): Promise<void>;
  storedPlaylists(userId: string): Promise<StoredPlaylist[]>;
  /** Insert or rename playlists without touching their songs or snapshot;
   *  returns Spotify id → playlist uuid. */
  upsertPlaylists(userId: string, playlists: PlaylistMeta[]): Promise<Map<string, string>>;
  /** Replace a playlist's songs and record its snapshot, as one step. */
  replacePlaylistSongs(
    playlistId: string,
    songs: { songId: string; addedAt: string | null }[],
    snapshotId: string,
  ): Promise<void>;
  removePlaylists(userId: string, sourceIds: string[]): Promise<void>;
  saveTaste(userId: string, snapshot: TasteSnapshot): Promise<void>;
}

export interface SyncInput {
  userId: string;
  spotifyUserId: string;
  recentCursor: string | null;
  lastDailySyncAt: string | null;
}

export interface SyncOutcome {
  recentCursor: string | null;
  /** True when this run did the daily pass (full likes + taste). */
  dailyDone: boolean;
  /** Set when plays may have been lost past Spotify's 50-play window. */
  gap: { from: string; to: string } | null;
}

/** 20,000 likes. Hitting it means paging broke, not that someone likes that much. */
const MAX_LIKE_PAGES = 400;

function songIdFor(ids: ReadonlyMap<string, string>, sourceId: string): string {
  const id = ids.get(sourceId);
  if (id === undefined) throw new Error(`songs upsert returned no id for Spotify track ${sourceId}`);
  return id;
}

/** Entries whose track is a song june can use, each with its song row. */
function withSongs<T extends { track: SpotifyTrack | null }>(entries: readonly T[]): (T & { row: SongRow })[] {
  const out: (T & { row: SongRow })[] = [];
  for (const entry of entries) {
    const row = entry.track === null ? null : toSongRow(entry.track);
    if (row !== null) out.push({ ...entry, row });
  }
  return out;
}

export async function syncUser(
  input: SyncInput,
  spotify: SpotifyClient,
  store: LibraryStore,
  now: Date,
): Promise<SyncOutcome> {
  const daily = dailyPassDue(input.lastDailySyncAt, now);

  const recent = await spotify.recentlyPlayed(
    input.recentCursor === null ? null : Date.parse(input.recentCursor),
  );
  const played = withSongs(recent.map((item) => ({ track: item.track, at: item.played_at })));
  const playedIds = await store.upsertSongs(uniqueSongRows(played.map((p) => p.row)));
  await store.addListens(
    input.userId,
    played.map((p) => ({ songId: songIdFor(playedIds, p.row.source_id), playedAt: p.at })),
  );
  const playedAt = recent.map((item) => item.played_at);

  await syncLikes(input.userId, daily, spotify, store);
  await syncPlaylists(input, spotify, store);
  if (daily) await syncTaste(input.userId, spotify, store);

  return {
    recentCursor: advanceCursor(playedAt, input.recentCursor),
    dailyDone: daily,
    gap: recentGap(playedAt, input.recentCursor),
  };
}

/**
 * Between daily passes, read likes newest first and stop at the first one
 * already stored. On the daily pass read them all, then drop stored likes that
 * weren't seen: Spotify has no "unliked" feed, so this is how an unlike lands.
 */
async function syncLikes(
  userId: string,
  full: boolean,
  spotify: SpotifyClient,
  store: LibraryStore,
): Promise<void> {
  const newestKnown = full ? null : await store.newestLikeAt(userId);
  const seen = new Set<string>();

  for (let page = 0; ; page++) {
    if (page >= MAX_LIKE_PAGES) {
      throw new Error(`liked songs were still paging after ${MAX_LIKE_PAGES} pages`);
    }
    const { items, next } = await spotify.savedTracks(page * SPOTIFY_PAGE_SIZE);
    const { fresh, done } = freshLikes(items, newestKnown);
    const liked = withSongs(fresh.map((item) => ({ track: item.track, at: item.added_at })));
    const ids = await store.upsertSongs(uniqueSongRows(liked.map((l) => l.row)));
    const likes = liked.map((l) => ({ songId: songIdFor(ids, l.row.source_id), addedAt: l.at }));
    await store.addLikes(userId, likes);
    for (const like of likes) seen.add(like.songId);
    if (done || next === null) break;
  }

  if (full) {
    await store.removeLikes(userId, likesToRemove(await store.likedSongIds(userId), seen));
  }
}

async function syncPlaylists(
  input: SyncInput,
  spotify: SpotifyClient,
  store: LibraryStore,
): Promise<void> {
  const plan = planPlaylists(
    await spotify.myPlaylists(),
    await store.storedPlaylists(input.userId),
    input.spotifyUserId,
  );
  const playlistIds = await store.upsertPlaylists(input.userId, plan.mine.map(toPlaylistMeta));

  for (const playlist of plan.refresh) {
    const playlistId = playlistIds.get(playlist.id);
    if (playlistId === undefined) {
      throw new Error(`playlists upsert returned no id for Spotify playlist ${playlist.id}`);
    }
    const entries = withSongs(
      (await spotify.playlistItems(playlist.id)).map((item) => ({
        track: item.item,
        at: item.added_at ?? null,
      })),
    );
    const songIds = await store.upsertSongs(uniqueSongRows(entries.map((e) => e.row)));
    await store.replacePlaylistSongs(
      playlistId,
      entries.map((e) => ({ songId: songIdFor(songIds, e.row.source_id), addedAt: e.at })),
      playlist.snapshot_id,
    );
  }

  await store.removePlaylists(input.userId, plan.remove);
}

async function syncTaste(userId: string, spotify: SpotifyClient, store: LibraryStore): Promise<void> {
  for (const range of TIME_RANGES) {
    const artists = await spotify.topArtists(range);
    await store.saveTaste(userId, { kind: "artists", range, items: artists.map(toTasteArtist) });

    const tracks = withSongs((await spotify.topTracks(range)).map((track) => ({ track })));
    await store.upsertSongs(uniqueSongRows(tracks.map((t) => t.row)));
    await store.saveTaste(userId, { kind: "tracks", range, items: tracks.map((t) => toTasteTrack(t.row)) });
  }
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/lib/spotify-sync-user.test.ts`
Expected: PASS, 8 tests.

Run: `npm test && npm run typecheck`
Expected: every suite passes; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spotify/sync-user.ts test/lib/spotify-sync-user.test.ts
git commit -m "Sync one user's Spotify library against an injectable store

Recent plays after the cursor, liked songs back to the newest already stored
(or all of them on the daily pass, which also drops unlikes), owned and
collaborative playlists re-read only when their snapshot changed, and the
top lists once a day. Written against interfaces so it is tested with
in-memory fakes rather than Spotify or Supabase."
git push
```

---

### Task 7: Supabase store, connections and the sync run

**Files:**
- Create: `src/lib/spotify/config.ts`, `src/lib/spotify/secret.ts`, `src/lib/spotify/store.ts`, `src/lib/spotify/connection.ts`, `src/lib/spotify/sync.ts`
- Test: `test/lib/spotify-secret.test.ts`

**Interfaces:**
- Consumes: `LibraryStore`, `TasteSnapshot`, `syncUser`, `SyncOutcome` (Task 6); `createSpotifyClient` (Task 5); `refreshTokens`, `TokenSet`, `SpotifyOAuthConfig` (Task 4); `classifySyncError`, `SyncFailure` (Task 2); `tokenNeedsRefresh` (Task 3); `SpotifyMe` (Task 2); `createServiceClient` (`src/lib/supabase/service.ts`)
- Produces:
  - `config.ts`: `spotifyConfig(): SpotifyOAuthConfig`, `spotifyRedirectUri(origin: string): string`, `SPOTIFY_STATE_COOKIE = "spotify_oauth_state"`
  - `secret.ts`: `bearerMatches(header: string | null, secret: string): boolean`
  - `store.ts`: `supabaseLibraryStore(db?: SupabaseClient): LibraryStore`
  - `connection.ts`: `interface ConnectionRow`, `class AlreadyLinkedError`, `saveConnection(userId: string, me: SpotifyMe, tokens: TokenSet): Promise<void>`, `activeConnections(userId?: string): Promise<ConnectionRow[]>`, `freshAccessToken(row: ConnectionRow, now: Date): Promise<string>`, `recordSuccess(userId: string, outcome: SyncOutcome, now: Date): Promise<void>`, `recordFailure(userId: string, failure: SyncFailure, now: Date): Promise<void>`, `connectionSyncState(userId: string): Promise<{ connected: false } | { connected: true; lastSyncedAt: string | null }>`, `claimSyncLease(seconds: number): Promise<string | null>`, `releaseSyncLease(holder: string): Promise<void>`, `deleteConnection(userId: string): Promise<void>`, `deleteSpotifyData(userId: string): Promise<void>`
  - `sync.ts`: `type SyncRunResult = { status: "busy" } | { status: "done"; synced: number; failed: number; rateLimited: boolean }`, `syncAllUsers(): Promise<SyncRunResult>`, `syncOneUser(userId: string): Promise<SyncRunResult>`

- [ ] **Step 1: Write the failing test**

Create `test/lib/spotify-secret.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bearerMatches } from "../../src/lib/spotify/secret";

describe("bearerMatches", () => {
  it("accepts exactly `Bearer <secret>`", () => {
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(bearerMatches(null, "s3cret")).toBe(false);
    expect(bearerMatches("Bearer wrong!", "s3cret")).toBe(false);
    expect(bearerMatches("s3cret", "s3cret")).toBe(false);
    expect(bearerMatches("Bearer s3cret ", "s3cret")).toBe(false);
  });

  it("refuses to compare against an empty secret", () => {
    expect(() => bearerMatches("Bearer ", "")).toThrow(/secret is empty/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run test/lib/spotify-secret.test.ts`
Expected: FAIL, "Failed to resolve import ../../src/lib/spotify/secret".

- [ ] **Step 3: Write `secret.ts` and `config.ts`**

Create `src/lib/spotify/secret.ts`:

```ts
import { timingSafeEqual } from "node:crypto";

/** Whether an Authorization header is exactly `Bearer <secret>`, compared in
 *  constant time so the secret can't be recovered by timing the answer. */
export function bearerMatches(header: string | null, secret: string): boolean {
  if (!secret) throw new Error("bearerMatches: secret is empty");
  if (header === null) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
```

Create `src/lib/spotify/config.ts`:

```ts
import type { SpotifyOAuthConfig } from "../../spotify/oauth";

export const SPOTIFY_STATE_COOKIE = "spotify_oauth_state";

export function spotifyConfig(): SpotifyOAuthConfig {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Spotify is not configured (set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET).",
    );
  }
  return { clientId, clientSecret };
}

/** Must match a redirect URI registered in the Spotify dashboard exactly, which
 *  is why local work on this feature runs at 127.0.0.1 rather than localhost. */
export function spotifyRedirectUri(origin: string): string {
  return `${origin}/api/spotify/callback`;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npx vitest run test/lib/spotify-secret.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the Supabase store**

Create `src/lib/spotify/store.ts`:

```ts
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "../supabase/service";
import type { LibraryStore } from "./sync-user";

/** Rows per request. Keeps each PostgREST call well under its size limits. */
const BATCH = 500;
/** Supabase's API returns at most this many rows per select. */
const MAX_ROWS = 1000;

function batches<T>(items: readonly T[], size = BATCH): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function check(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** The library sync's writes, with the service role: users can read these
 *  tables but never write them, so a library can't be forged. */
export function supabaseLibraryStore(db: SupabaseClient = createServiceClient()): LibraryStore {
  return {
    async upsertSongs(rows) {
      const ids = new Map<string, string>();
      for (const batch of batches(rows)) {
        const { data, error } = await db
          .from("songs")
          .upsert(batch, { onConflict: "source,source_id" })
          .select("id, source_id");
        check("upsert songs", error);
        for (const row of (data ?? []) as { id: string; source_id: string }[]) {
          ids.set(row.source_id, row.id);
        }
      }
      return ids;
    },

    async addListens(userId, listens) {
      for (const batch of batches(listens)) {
        const { error } = await db.from("listens").upsert(
          batch.map((l) => ({ user_id: userId, song_id: l.songId, source: "spotify", played_at: l.playedAt })),
          { onConflict: "user_id,source,played_at", ignoreDuplicates: true },
        );
        check("insert listens", error);
      }
    },

    async newestLikeAt(userId) {
      const { data, error } = await db
        .from("library_songs")
        .select("added_at")
        .eq("user_id", userId)
        .eq("source", "spotify")
        .order("added_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      check("read newest like", error);
      return (data as { added_at: string } | null)?.added_at ?? null;
    },

    async addLikes(userId, likes) {
      for (const batch of batches(likes)) {
        const { error } = await db.from("library_songs").upsert(
          batch.map((l) => ({ user_id: userId, song_id: l.songId, source: "spotify", added_at: l.addedAt })),
          { onConflict: "user_id,source,song_id", ignoreDuplicates: true },
        );
        check("insert likes", error);
      }
    },

    async likedSongIds(userId) {
      const ids: string[] = [];
      for (let from = 0; ; from += MAX_ROWS) {
        const { data, error } = await db
          .from("library_songs")
          .select("song_id")
          .eq("user_id", userId)
          .eq("source", "spotify")
          .order("song_id")
          .range(from, from + MAX_ROWS - 1);
        check("read liked song ids", error);
        const rows = (data ?? []) as { song_id: string }[];
        ids.push(...rows.map((r) => r.song_id));
        if (rows.length < MAX_ROWS) return ids;
      }
    },

    async removeLikes(userId, songIds) {
      for (const batch of batches(songIds, 100)) {
        const { error } = await db
          .from("library_songs")
          .delete()
          .eq("user_id", userId)
          .eq("source", "spotify")
          .in("song_id", batch);
        check("remove unliked songs", error);
      }
    },

    async storedPlaylists(userId) {
      const { data, error } = await db
        .from("playlists")
        .select("source_id, snapshot_id")
        .eq("user_id", userId)
        .eq("source", "spotify");
      check("read playlists", error);
      return ((data ?? []) as { source_id: string; snapshot_id: string | null }[]).map((p) => ({
        sourceId: p.source_id,
        snapshotId: p.snapshot_id,
      }));
    },

    async upsertPlaylists(userId, playlists) {
      const ids = new Map<string, string>();
      for (const batch of batches(playlists)) {
        // snapshot_id and song_count are left out: only replace_playlist_songs
        // sets them, once the songs are actually in.
        const { data, error } = await db
          .from("playlists")
          .upsert(
            batch.map((p) => ({ user_id: userId, ...p })),
            { onConflict: "user_id,source,source_id" },
          )
          .select("id, source_id");
        check("upsert playlists", error);
        for (const row of (data ?? []) as { id: string; source_id: string }[]) {
          ids.set(row.source_id, row.id);
        }
      }
      return ids;
    },

    async replacePlaylistSongs(playlistId, songs, snapshotId) {
      const { error } = await db.rpc("replace_playlist_songs", {
        p_playlist: playlistId,
        p_snapshot: snapshotId,
        p_song_ids: songs.map((s) => s.songId),
        p_added_at: songs.map((s) => s.addedAt),
      });
      check("replace playlist songs", error);
    },

    async removePlaylists(userId, sourceIds) {
      for (const batch of batches(sourceIds, 100)) {
        const { error } = await db
          .from("playlists")
          .delete()
          .eq("user_id", userId)
          .eq("source", "spotify")
          .in("source_id", batch);
        check("remove playlists", error);
      }
    },

    async saveTaste(userId, snapshot) {
      const { error } = await db.from("taste_snapshots").upsert(
        {
          user_id: userId,
          source: "spotify",
          kind: snapshot.kind,
          time_range: snapshot.range,
          items: snapshot.items,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "user_id,source,kind,time_range" },
      );
      check("save taste snapshot", error);
    },
  };
}
```

- [ ] **Step 6: Write the connection module**

Create `src/lib/spotify/connection.ts`:

```ts
import "server-only";
import type { SyncFailure } from "../../spotify/errors";
import { tokenNeedsRefresh } from "../../spotify/diff";
import { refreshTokens, type TokenSet } from "../../spotify/oauth";
import type { SpotifyMe } from "../../spotify/schema";
import { createServiceClient } from "../supabase/service";
import { spotifyConfig } from "./config";
import type { SyncOutcome } from "./sync-user";

export interface ConnectionRow {
  user_id: string;
  spotify_user_id: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  recent_cursor: string | null;
  last_daily_sync_at: string | null;
}

const CONNECTION_COLUMNS =
  "user_id, spotify_user_id, refresh_token, access_token, access_token_expires_at, recent_cursor, last_daily_sync_at";

/** The Spotify account is already linked to a different june user. */
export class AlreadyLinkedError extends Error {
  constructor() {
    super("That Spotify account is already connected to another june account.");
    this.name = "AlreadyLinkedError";
  }
}

function check(what: string, error: { message: string } | null): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

/** Save (or re-save, on reconnect) a user's connection. The cursor and daily
 *  timestamps aren't sent, so a reconnect keeps them. */
export async function saveConnection(userId: string, me: SpotifyMe, tokens: TokenSet): Promise<void> {
  if (tokens.refreshToken === null) {
    throw new Error("Spotify returned no refresh token. Try connecting again.");
  }
  const { error } = await createServiceClient()
    .from("spotify_connections")
    .upsert(
      {
        user_id: userId,
        spotify_user_id: me.id,
        display_name: me.display_name ?? null,
        refresh_token: tokens.refreshToken,
        access_token: tokens.accessToken,
        access_token_expires_at: tokens.expiresAt.toISOString(),
        status: "active",
        last_error: null,
        last_error_at: null,
        connected_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  // spotify_user_id is unique: one Spotify account, one june user.
  if (error?.code === "23505") throw new AlreadyLinkedError();
  check("save Spotify connection", error);
}

export async function activeConnections(userId?: string): Promise<ConnectionRow[]> {
  let query = createServiceClient()
    .from("spotify_connections")
    .select(CONNECTION_COLUMNS)
    .eq("status", "active");
  if (userId !== undefined) query = query.eq("user_id", userId);
  const { data, error } = await query.order("connected_at");
  check("read Spotify connections", error);
  return (data ?? []) as ConnectionRow[];
}

/** A usable access token, refreshed and saved first when it has a minute or
 *  less left. A revoked grant throws SpotifyAuthError("invalid_grant"). */
export async function freshAccessToken(row: ConnectionRow, now: Date): Promise<string> {
  if (row.access_token !== null && !tokenNeedsRefresh(row.access_token_expires_at, now)) {
    return row.access_token;
  }
  const tokens = await refreshTokens(row.refresh_token, spotifyConfig());
  const update: Record<string, string> = {
    access_token: tokens.accessToken,
    access_token_expires_at: tokens.expiresAt.toISOString(),
  };
  if (tokens.refreshToken !== null) update.refresh_token = tokens.refreshToken;
  const { error } = await createServiceClient()
    .from("spotify_connections")
    .update(update)
    .eq("user_id", row.user_id);
  check("save refreshed Spotify token", error);
  return tokens.accessToken;
}

export async function recordSuccess(userId: string, outcome: SyncOutcome, now: Date): Promise<void> {
  const update: Record<string, string | null> = {
    recent_cursor: outcome.recentCursor,
    last_synced_at: now.toISOString(),
    last_error: null,
    last_error_at: null,
  };
  if (outcome.dailyDone) update.last_daily_sync_at = now.toISOString();
  const { error } = await createServiceClient()
    .from("spotify_connections")
    .update(update)
    .eq("user_id", userId);
  check("record Spotify sync", error);
}

export async function recordFailure(userId: string, failure: SyncFailure, now: Date): Promise<void> {
  const update: Record<string, string> = {
    last_error: failure.message,
    last_error_at: now.toISOString(),
  };
  if (failure.kind === "revoked") update.status = "revoked";
  const { error } = await createServiceClient()
    .from("spotify_connections")
    .update(update)
    .eq("user_id", userId);
  check("record Spotify sync failure", error);
}

/** Whether the user is connected, and when they last synced (for Sync now). */
export async function connectionSyncState(
  userId: string,
): Promise<{ connected: false } | { connected: true; lastSyncedAt: string | null }> {
  const { data, error } = await createServiceClient()
    .from("spotify_connections")
    .select("last_synced_at")
    .eq("user_id", userId)
    .maybeSingle();
  check("read Spotify connection", error);
  if (data === null) return { connected: false };
  return { connected: true, lastSyncedAt: (data as { last_synced_at: string | null }).last_synced_at };
}

/** The lease holder id, or null when another run holds it. */
export async function claimSyncLease(seconds: number): Promise<string | null> {
  const { data, error } = await createServiceClient().rpc("claim_spotify_sync", {
    p_seconds: seconds,
  });
  check("claim Spotify sync lease", error);
  return (data as string | null) ?? null;
}

export async function releaseSyncLease(holder: string): Promise<void> {
  const { error } = await createServiceClient().rpc("release_spotify_sync", { p_holder: holder });
  check("release Spotify sync lease", error);
}

/** Drops the tokens. The library stays. */
export async function deleteConnection(userId: string): Promise<void> {
  const { error } = await createServiceClient()
    .from("spotify_connections")
    .delete()
    .eq("user_id", userId);
  check("delete Spotify connection", error);
}

/** Drops the tokens and everything synced from Spotify for this user. Shared
 *  songs rows stay: they name no user. */
export async function deleteSpotifyData(userId: string): Promise<void> {
  await deleteConnection(userId);
  const db = createServiceClient();
  for (const table of ["library_songs", "listens", "taste_snapshots", "playlists"]) {
    const { error } = await db.from(table).delete().eq("user_id", userId).eq("source", "spotify");
    check(`delete Spotify ${table}`, error);
  }
}
```

- [ ] **Step 7: Write the run**

Create `src/lib/spotify/sync.ts`:

```ts
import "server-only";
import { createSpotifyClient } from "../../spotify/client";
import { classifySyncError, type SyncFailure } from "../../spotify/errors";
import {
  activeConnections,
  claimSyncLease,
  freshAccessToken,
  recordFailure,
  recordSuccess,
  releaseSyncLease,
  type ConnectionRow,
} from "./connection";
import { supabaseLibraryStore } from "./store";
import { syncUser } from "./sync-user";

/** Longer than a first sync of a large library, shorter than the cron gap. */
const LEASE_SECONDS = 300;

export type SyncRunResult =
  | { status: "busy" }
  | { status: "done"; synced: number; failed: number; rateLimited: boolean };

/** Sync one connection. A failure is recorded on the connection (where
 *  /library shows it) and logged; the caller only needs its kind. */
async function syncConnection(row: ConnectionRow, now: Date): Promise<SyncFailure | null> {
  try {
    const accessToken = await freshAccessToken(row, now);
    const outcome = await syncUser(
      {
        userId: row.user_id,
        spotifyUserId: row.spotify_user_id,
        recentCursor: row.recent_cursor,
        lastDailySyncAt: row.last_daily_sync_at,
      },
      createSpotifyClient({ accessToken }),
      supabaseLibraryStore(),
      now,
    );
    if (outcome.gap) {
      console.warn(
        `Spotify listens for ${row.user_id} may be missing plays between ${outcome.gap.from} and ${outcome.gap.to}.`,
      );
    }
    await recordSuccess(row.user_id, outcome, now);
    return null;
  } catch (err) {
    const failure = classifySyncError(err);
    console.error(`Spotify sync failed for ${row.user_id} (${failure.kind}):`, err);
    await recordFailure(row.user_id, failure, now);
    return failure;
  }
}

async function run(rows: () => Promise<ConnectionRow[]>): Promise<SyncRunResult> {
  const holder = await claimSyncLease(LEASE_SECONDS);
  if (holder === null) return { status: "busy" };
  try {
    let synced = 0;
    let failed = 0;
    for (const row of await rows()) {
      const failure = await syncConnection(row, new Date());
      if (failure === null) {
        synced++;
        continue;
      }
      failed++;
      // Quota is shared across the developer account: carrying on would only
      // spend the next user's calls on the same 429.
      if (failure.kind === "rate-limited") return { status: "done", synced, failed, rateLimited: true };
    }
    return { status: "done", synced, failed, rateLimited: false };
  } finally {
    await releaseSyncLease(holder);
  }
}

/** Every active connection, one at a time. The cron entry point. */
export function syncAllUsers(): Promise<SyncRunResult> {
  return run(() => activeConnections());
}

/** One user, for their first sync and for Sync now. */
export function syncOneUser(userId: string): Promise<SyncRunResult> {
  return run(() => activeConnections(userId));
}
```

- [ ] **Step 8: Typecheck and run everything**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm test`
Expected: every suite passes. (No test imports `store.ts`, `connection.ts` or `sync.ts`; they are `server-only` and are exercised end to end in Task 11.)

- [ ] **Step 9: Commit**

```bash
git add src/lib/spotify/config.ts src/lib/spotify/secret.ts src/lib/spotify/store.ts src/lib/spotify/connection.ts src/lib/spotify/sync.ts test/lib/spotify-secret.test.ts
git commit -m "Run the Spotify sync against Supabase

A LibraryStore over the service client, connection bookkeeping (tokens
refreshed and saved before they expire, each run's outcome or error recorded
on the connection), and a run that takes the lease, syncs connections one at
a time, and stops everyone on a 429 since quota is shared."
git push
```

---

### Task 8: Connect, callback and sync routes

**Files:**
- Create: `src/lib/when.ts`, `src/lib/spotify/messages.ts`, `app/api/spotify/connect/route.ts`, `app/api/spotify/callback/route.ts`, `app/api/spotify/sync/route.ts`
- Modify: `app/recent-plays.tsx` (use the shared `when`)
- Test: `test/lib/when.test.ts`, `test/lib/spotify-messages.test.ts`

**Interfaces:**
- Consumes: `spotifyConfig`, `spotifyRedirectUri`, `SPOTIFY_STATE_COOKIE`, `bearerMatches`, `saveConnection`, `AlreadyLinkedError`, `syncAllUsers`, `syncOneUser` (Task 7); `authorizeUrl`, `exchangeCode`, `stateCookieValue`, `stateMatches` (Task 4); `createSpotifyClient` (Task 5); `isNotApprovedForApp` (Task 2)
- Produces:
  - `connectErrorText(code: string): string`
  - `interface SpotifyStatusView { displayName: string | null; status: "active" | "revoked"; lastSyncedAt: string | null }`, `spotifyStatusLine(status: SpotifyStatusView, now: number): string`
  - `GET /api/spotify/connect`, `GET /api/spotify/callback`, `POST /api/spotify/sync`
  - `/library?spotify=connected` and `/library?spotify_error=<code or message>`

This task also moves `when` (relative time) out of `app/recent-plays.tsx` into `src/lib/when.ts`, with `now` as a parameter, because `spotifyStatusLine` and `/library` need it too.

- [ ] **Step 1: Write the failing tests**

Create `test/lib/when.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { when } from "../../src/lib/when";

const NOW = Date.parse("2026-09-25T12:00:00Z");

describe("when", () => {
  it("reads coarsely, from just now to days", () => {
    expect(when("2026-09-25T11:59:40Z", NOW)).toBe("just now");
    expect(when("2026-09-25T11:55:00Z", NOW)).toBe("5m ago");
    expect(when("2026-09-25T09:00:00Z", NOW)).toBe("3h ago");
    expect(when("2026-09-24T12:00:00Z", NOW)).toBe("yesterday");
    expect(when("2026-09-22T12:00:00Z", NOW)).toBe("3 days ago");
  });

  it("never reads a future time as negative", () => {
    expect(when("2026-09-25T12:05:00Z", NOW)).toBe("just now");
  });
});
```

Create `test/lib/spotify-messages.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { connectErrorText, spotifyStatusLine } from "../../src/lib/spotify/messages";

describe("connectErrorText", () => {
  it("names the not-approved case the way the spec words it", () => {
    expect(connectErrorText("not_approved")).toBe(
      "Spotify hasn't approved this account for june yet — ask Jacob to add it.",
    );
  });

  it("explains the known codes", () => {
    expect(connectErrorText("already_linked")).toMatch(/already connected to another june account/);
    expect(connectErrorText("access_denied")).toMatch(/cancelled/);
    expect(connectErrorText("state")).toMatch(/expired/);
    expect(connectErrorText("missing_code")).toMatch(/code/);
  });

  it("shows anything else verbatim rather than hiding it", () => {
    expect(connectErrorText("Spotify token request failed (500): boom")).toBe(
      "Couldn't connect Spotify: Spotify token request failed (500): boom",
    );
  });
});

describe("spotifyStatusLine", () => {
  const NOW = Date.parse("2026-09-25T12:00:00Z");

  it("says who is connected and when it last synced", () => {
    expect(
      spotifyStatusLine({ displayName: "Jacob", status: "active", lastSyncedAt: "2026-09-25T11:55:00Z" }, NOW),
    ).toBe("Connected to Spotify as Jacob · last synced 5m ago");
  });

  it("says when it hasn't synced yet", () => {
    expect(spotifyStatusLine({ displayName: null, status: "active", lastSyncedAt: null }, NOW)).toBe(
      "Connected to Spotify · not synced yet",
    );
  });

  it("asks for a reconnect once access is revoked", () => {
    expect(spotifyStatusLine({ displayName: "Jacob", status: "revoked", lastSyncedAt: null }, NOW)).toBe(
      "Spotify access was revoked. Reconnect to keep syncing.",
    );
  });
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npx vitest run test/lib/when.test.ts test/lib/spotify-messages.test.ts`
Expected: FAIL, "Failed to resolve import ../../src/lib/when" (and `messages`).

- [ ] **Step 3: Move `when` and write the messages**

Create `src/lib/when.ts`:

```ts
/** "5m ago", "yesterday" — coarse on purpose; a play doesn't need a clock. */
export function when(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}
```

In `app/recent-plays.tsx`, delete the local `when` function (the comment line `/** "3 minutes ago", "yesterday" — coarse on purpose; a play doesn't need a clock. */` and the ten-line function under it) and add the import:

```tsx
import Link from "next/link";
import { getPastJams, getRecentPlays } from "@/src/lib/room/plays";
import { when } from "@/src/lib/when";
```

Create `src/lib/spotify/messages.ts`:

```ts
import { when } from "../when";

/** What /library says for each ?spotify_error= the callback sends back. An
 *  unknown code is an error message from the callback, shown as it is. */
export function connectErrorText(code: string): string {
  switch (code) {
    case "not_approved":
      return "Spotify hasn't approved this account for june yet — ask Jacob to add it.";
    case "already_linked":
      return "That Spotify account is already connected to another june account.";
    case "access_denied":
      return "Spotify connection cancelled.";
    case "state":
      return "That connection link expired or came from another session. Try connecting again.";
    case "missing_code":
      return "Spotify didn't send back a code. Try connecting again.";
    default:
      return `Couldn't connect Spotify: ${code}`;
  }
}

export interface SpotifyStatusView {
  displayName: string | null;
  status: "active" | "revoked";
  lastSyncedAt: string | null;
}

export function spotifyStatusLine(status: SpotifyStatusView, now: number): string {
  if (status.status === "revoked") return "Spotify access was revoked. Reconnect to keep syncing.";
  const who = status.displayName ? ` as ${status.displayName}` : "";
  const synced = status.lastSyncedAt ? `last synced ${when(status.lastSyncedAt, now)}` : "not synced yet";
  return `Connected to Spotify${who} · ${synced}`;
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run test/lib/when.test.ts test/lib/spotify-messages.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the three routes**

Create `app/api/spotify/connect/route.ts`:

```ts
import { NextResponse } from "next/server";
import { SPOTIFY_STATE_COOKIE, spotifyConfig, spotifyRedirectUri } from "@/src/lib/spotify/config";
import { createClient } from "@/src/lib/supabase/server";
import { authorizeUrl, stateCookieValue } from "@/src/spotify/oauth";

/** Starts "Connect Spotify": remembers who asked, then hands over to Spotify. */
export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/?next=${encodeURIComponent("/library")}`);

  let clientId: string;
  try {
    ({ clientId } = spotifyConfig());
  } catch (err) {
    return NextResponse.redirect(
      `${origin}/library?spotify_error=${encodeURIComponent((err as Error).message)}`,
    );
  }

  const nonce = crypto.randomUUID();
  const response = NextResponse.redirect(
    authorizeUrl({ clientId, redirectUri: spotifyRedirectUri(origin), state: nonce }),
  );
  response.cookies.set(SPOTIFY_STATE_COOKIE, stateCookieValue(user.id, nonce), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // lax: the callback arrives as a top-level navigation from Spotify.
    sameSite: "lax",
    path: "/api/spotify",
    maxAge: 10 * 60,
  });
  return response;
}
```

Create `app/api/spotify/callback/route.ts`:

```ts
import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { SPOTIFY_STATE_COOKIE, spotifyConfig, spotifyRedirectUri } from "@/src/lib/spotify/config";
import { AlreadyLinkedError, saveConnection } from "@/src/lib/spotify/connection";
import { syncOneUser } from "@/src/lib/spotify/sync";
import { createClient } from "@/src/lib/supabase/server";
import { createSpotifyClient } from "@/src/spotify/client";
import { isNotApprovedForApp } from "@/src/spotify/errors";
import { exchangeCode, stateMatches } from "@/src/spotify/oauth";

/** A first sync of a large library runs in after() and needs the room. */
export const maxDuration = 300;

/**
 * Spotify sends the user back here. Check the state, exchange the code, save
 * the connection, and start the first sync after answering, so the user lands
 * on /library straight away.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const back = (query: string) => {
    const response = NextResponse.redirect(`${origin}/library?${query}`);
    response.cookies.set(SPOTIFY_STATE_COOKIE, "", { path: "/api/spotify", maxAge: 0 });
    return response;
  };
  const fail = (code: string) => back(`spotify_error=${encodeURIComponent(code)}`);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/?next=${encodeURIComponent("/library")}`);

  const refused = searchParams.get("error");
  if (refused) return fail(refused);

  const cookieStore = await cookies();
  if (!stateMatches(cookieStore.get(SPOTIFY_STATE_COOKIE)?.value, searchParams.get("state"), user.id)) {
    return fail("state");
  }

  const code = searchParams.get("code");
  if (!code) return fail("missing_code");

  try {
    const tokens = await exchangeCode(code, spotifyRedirectUri(origin), spotifyConfig());
    const me = await createSpotifyClient({ accessToken: tokens.accessToken }).me();
    await saveConnection(user.id, me, tokens);
  } catch (err) {
    if (isNotApprovedForApp(err)) return fail("not_approved");
    if (err instanceof AlreadyLinkedError) return fail("already_linked");
    console.error("Spotify connect failed:", err);
    return fail(err instanceof Error ? err.message : String(err));
  }

  const userId = user.id;
  after(async () => {
    try {
      const result = await syncOneUser(userId);
      if (result.status === "busy") {
        console.warn(`First Spotify sync for ${userId} deferred: another run holds the lease.`);
      }
    } catch (err) {
      console.error(`First Spotify sync for ${userId} failed:`, err);
    }
  });

  return back("spotify=connected");
}
```

Create `app/api/spotify/sync/route.ts`:

```ts
import { after, NextResponse } from "next/server";
import { bearerMatches } from "@/src/lib/spotify/secret";
import { syncAllUsers } from "@/src/lib/spotify/sync";

export const maxDuration = 300;

/**
 * Called by pg_cron every 30 minutes. Answers at once and syncs after the
 * response: pg_net gives up on a request after 10 seconds, and a first sync
 * can take longer than that.
 */
export async function POST(request: Request) {
  const secret = process.env.SPOTIFY_SYNC_SECRET;
  if (!secret) {
    console.error("SPOTIFY_SYNC_SECRET is not set; refusing to sync.");
    return NextResponse.json({ error: "sync is not configured" }, { status: 500 });
  }
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  after(async () => {
    try {
      const result = await syncAllUsers();
      if (result.status === "busy") {
        console.warn("Spotify sync skipped: a previous run still holds the lease.");
      }
    } catch (err) {
      console.error("Spotify sync run failed:", err);
    }
  });

  return NextResponse.json({ accepted: true }, { status: 202 });
}
```

- [ ] **Step 6: Verify**

Run: `npm test && npm run typecheck && npm run build`
Expected: tests pass, no type errors, build succeeds and lists `/api/spotify/connect`, `/api/spotify/callback` and `/api/spotify/sync` as dynamic routes (ƒ).

Then check the sync route refuses without the secret. With `npm run dev` running and `SPOTIFY_SYNC_SECRET` set in `.env.local`:

Run: `curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3000/api/spotify/sync`
Expected: `401`

Run: `curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Authorization: Bearer wrong' http://127.0.0.1:3000/api/spotify/sync`
Expected: `401`

If `SPOTIFY_SYNC_SECRET` isn't set yet, both return `500` and the dev server logs `SPOTIFY_SYNC_SECRET is not set; refusing to sync.`, which is also correct. Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/lib/when.ts app/recent-plays.tsx src/lib/spotify/messages.ts app/api/spotify test/lib/when.test.ts test/lib/spotify-messages.test.ts
git commit -m "Add the Spotify connect, callback and sync routes

Connect binds a nonce to the june user in a short-lived cookie; the callback
checks it, saves the connection and starts the first sync after answering.
An account not added in Spotify's dashboard gets its own message. The sync
route takes a bearer secret, answers 202, and runs in after() so pg_net's
10-second timeout doesn't cut it short. Relative time moves to src/lib/when
so /library can share it."
git push
```

---

### Task 9: The `/library` page

**Files:**
- Create: `src/lib/spotify/library.ts`, `src/lib/spotify/actions.ts`, `app/library/page.tsx`, `app/library/spotify-controls.tsx`, `app/library/song-list.tsx`
- Modify: `app/page.tsx` (account bar link), `app/globals.css` (a `/library` block before `/* ---- Motion ---- */`)

**Interfaces:**
- Consumes: `connectErrorText`, `spotifyStatusLine`, `SpotifyStatusView`, `when` (all Task 8); `syncOneUser` (Task 7); `connectionSyncState`, `deleteConnection`, `deleteSpotifyData` (Task 7); `syncNowAllowed` (Task 3)
- Produces:
  - `library.ts`: `interface SpotifyStatus extends SpotifyStatusView { lastError: string | null; lastErrorAt: string | null }`, `interface LibrarySong { title: string; artists: string[]; artworkUrl: string | null; at: string }`, `interface LibraryPlaylist { id: string; name: string; artworkUrl: string | null; songCount: number }`, `getSpotifyStatus(): Promise<SpotifyStatus | null>`, `getLikedSongs(userId: string, limit: number): Promise<{ songs: LibrarySong[]; total: number }>`, `getLibraryPlaylists(userId: string): Promise<LibraryPlaylist[]>`, `getRecentListens(userId: string, limit: number): Promise<LibrarySong[]>`
  - `actions.ts`: `type ActionResult = { ok: boolean; notice: string }`, `syncNowAction()`, `disconnectSpotifyAction()`, `deleteSpotifyDataAction()`, each `Promise<ActionResult>`

- [ ] **Step 1: Write the reads**

Create `src/lib/spotify/library.ts`:

```ts
import { createClient } from "../supabase/server";
import type { SpotifyStatusView } from "./messages";

/**
 * What /library shows. Read with the signed-in user's own client, so RLS
 * scopes every row to them; the connection status comes through
 * my_spotify_connection(), which never returns tokens.
 */

export interface SpotifyStatus extends SpotifyStatusView {
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface LibrarySong {
  title: string;
  artists: string[];
  artworkUrl: string | null;
  /** When it was liked or played. */
  at: string;
}

export interface LibraryPlaylist {
  id: string;
  name: string;
  artworkUrl: string | null;
  songCount: number;
}

type SongJoin = { title: string; artists: string[]; artwork_url: string | null } | null;

function toLibrarySong(song: SongJoin, at: string): LibrarySong {
  // song_id is a non-null foreign key, so a missing song is a broken read.
  if (song === null) throw new Error("library row came back without its song");
  return { title: song.title, artists: song.artists, artworkUrl: song.artwork_url, at };
}

export async function getSpotifyStatus(): Promise<SpotifyStatus | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_spotify_connection");
  if (error) throw new Error(`read Spotify connection: ${error.message}`);
  const row = ((data ?? []) as {
    display_name: string | null;
    status: "active" | "revoked";
    last_synced_at: string | null;
    last_error: string | null;
    last_error_at: string | null;
  }[])[0];
  if (!row) return null;
  return {
    displayName: row.display_name,
    status: row.status,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    lastErrorAt: row.last_error_at,
  };
}

export async function getLikedSongs(
  userId: string,
  limit: number,
): Promise<{ songs: LibrarySong[]; total: number }> {
  const supabase = await createClient();
  const { data, count, error } = await supabase
    .from("library_songs")
    .select("added_at, songs(title, artists, artwork_url)", { count: "exact" })
    .eq("user_id", userId)
    .order("added_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`read liked songs: ${error.message}`);
  const rows = (data ?? []) as unknown as { added_at: string; songs: SongJoin }[];
  return { songs: rows.map((r) => toLibrarySong(r.songs, r.added_at)), total: count ?? rows.length };
}

export async function getLibraryPlaylists(userId: string): Promise<LibraryPlaylist[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("playlists")
    .select("id, name, artwork_url, song_count")
    .eq("user_id", userId)
    .order("name");
  if (error) throw new Error(`read playlists: ${error.message}`);
  return ((data ?? []) as { id: string; name: string; artwork_url: string | null; song_count: number }[]).map(
    (p) => ({ id: p.id, name: p.name, artworkUrl: p.artwork_url, songCount: p.song_count }),
  );
}

export async function getRecentListens(userId: string, limit: number): Promise<LibrarySong[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("listens")
    .select("played_at, songs(title, artists, artwork_url)")
    .eq("user_id", userId)
    .order("played_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`read recent listens: ${error.message}`);
  const rows = (data ?? []) as unknown as { played_at: string; songs: SongJoin }[];
  return rows.map((r) => toLibrarySong(r.songs, r.played_at));
}
```

- [ ] **Step 2: Write the actions**

Create `src/lib/spotify/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { syncNowAllowed } from "../../spotify/diff";
import { createClient } from "../supabase/server";
import { connectionSyncState, deleteConnection, deleteSpotifyData } from "./connection";
import { syncOneUser } from "./sync";

/**
 * /library's buttons. Every action acts on the caller alone: the user id comes
 * from their session, never from an argument, so these can't be pointed at
 * someone else's connection.
 */

export type ActionResult = { ok: boolean; notice: string };

async function requireUserId(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be signed in.");
  return user.id;
}

export async function syncNowAction(): Promise<ActionResult> {
  const userId = await requireUserId();
  const state = await connectionSyncState(userId);
  if (!state.connected) return { ok: false, notice: "Spotify isn't connected." };
  if (!syncNowAllowed(state.lastSyncedAt, new Date())) {
    return { ok: false, notice: "Synced less than a minute ago." };
  }

  const result = await syncOneUser(userId);
  revalidatePath("/library");
  if (result.status === "busy") {
    return { ok: false, notice: "A sync is already running. Try again in a minute." };
  }
  if (result.failed > 0) return { ok: false, notice: "Sync failed. The error is shown above." };
  return { ok: true, notice: "Synced." };
}

export async function disconnectSpotifyAction(): Promise<ActionResult> {
  await deleteConnection(await requireUserId());
  revalidatePath("/library");
  return { ok: true, notice: "Disconnected. Your library stays in june." };
}

export async function deleteSpotifyDataAction(): Promise<ActionResult> {
  await deleteSpotifyData(await requireUserId());
  revalidatePath("/library");
  return { ok: true, notice: "Disconnected, and your Spotify library is deleted from june." };
}
```

- [ ] **Step 3: Write the components**

Create `app/library/song-list.tsx`:

```tsx
import { when } from "@/src/lib/when";
import type { LibrarySong } from "@/src/lib/spotify/library";

/** Songs with their art, artists and when they were liked or played. Reuses
 *  the home page's history rows so the two lists read the same. */
export function SongList({ songs, now }: { songs: LibrarySong[]; now: number }) {
  return (
    <ul className="home-history__list">
      {songs.map((song, i) => (
        <li key={`${song.at}:${i}`} className="home-play">
          {song.artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="home-play__art" src={song.artworkUrl} alt="" loading="lazy" />
          ) : (
            <div className="home-play__art" />
          )}
          <div className="home-play__meta">
            <span className="home-play__title">{song.title}</span>
            <span className="home-play__sub">
              {song.artists.join(", ")} · {when(song.at, now)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
```

Create `app/library/spotify-controls.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import {
  deleteSpotifyDataAction,
  disconnectSpotifyAction,
  syncNowAction,
  type ActionResult,
} from "@/src/lib/spotify/actions";

/**
 * The connection's buttons. Times are formatted on the server and passed in
 * as text, so the client never renders a relative time that differs from the
 * server's.
 */
export function SpotifyControls({
  connected,
  revoked,
  line,
  error,
}: {
  connected: boolean;
  revoked: boolean;
  line: string | null;
  error: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const run = (action: () => Promise<ActionResult>) =>
    startTransition(async () => {
      try {
        setResult(await action());
      } catch (err) {
        setResult({ ok: false, notice: err instanceof Error ? err.message : String(err) });
      }
    });

  if (!connected) {
    return (
      <div className="lib__connect">
        <p className="muted">
          Connect Spotify to bring your liked songs, playlists and listening into june. Spotify
          limits june to five accounts, so ask Jacob before connecting.
        </p>
        <div className="lib__actions">
          <a className="btn btn--primary" href="/api/spotify/connect">
            Connect Spotify
          </a>
        </div>
        {result && <p className="lib__notice" role="status">{result.notice}</p>}
      </div>
    );
  }

  return (
    <div className="lib__status">
      {line && <p className="lib__line">{line}</p>}
      {error && (
        <p className="lib__notice lib__notice--error" role="alert">
          {error}
        </p>
      )}
      <div className="lib__actions">
        {revoked ? (
          <a className="btn btn--sm" href="/api/spotify/connect">
            Reconnect
          </a>
        ) : (
          <button className="btn btn--sm" disabled={pending} onClick={() => run(syncNowAction)}>
            Sync now
          </button>
        )}
        <button className="btn btn--sm" disabled={pending} onClick={() => run(disconnectSpotifyAction)}>
          Disconnect
        </button>
        <button
          className="btn btn--sm"
          disabled={pending}
          onClick={() => {
            if (!confirmingDelete) {
              setConfirmingDelete(true);
              return;
            }
            setConfirmingDelete(false);
            run(deleteSpotifyDataAction);
          }}
        >
          {confirmingDelete ? "Click again to delete everything" : "Disconnect and delete my Spotify data"}
        </button>
      </div>
      {result && (
        <p className={`lib__notice${result.ok ? "" : " lib__notice--error"}`} role="status">
          {result.notice}
        </p>
      )}
    </div>
  );
}
```

Create `app/library/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  getLibraryPlaylists,
  getLikedSongs,
  getRecentListens,
  getSpotifyStatus,
} from "@/src/lib/spotify/library";
import { connectErrorText, spotifyStatusLine } from "@/src/lib/spotify/messages";
import { createClient } from "@/src/lib/supabase/server";
import { when } from "@/src/lib/when";
import { SongList } from "./song-list";
import { SpotifyControls } from "./spotify-controls";

const LIKED_SHOWN = 100;
const LISTENS_SHOWN = 30;

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ spotify?: string; spotify_error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/?next=${encodeURIComponent("/library")}`);

  const sp = await searchParams;
  const now = Date.now();
  const status = await getSpotifyStatus();
  const [liked, playlists, listens] = status
    ? await Promise.all([
        getLikedSongs(user.id, LIKED_SHOWN),
        getLibraryPlaylists(user.id),
        getRecentListens(user.id, LISTENS_SHOWN),
      ])
    : [null, [], []];

  const syncError =
    status?.lastError != null
      ? `Last sync failed${status.lastErrorAt ? ` ${when(status.lastErrorAt, now)}` : ""}: ${status.lastError}`
      : null;

  return (
    <main className="pl">
      <a href="/" className="pl__back">
        <ArrowLeft size={15} />
        Back
      </a>
      <header className="pl__head">
        <h1 className="pl__title">Your library</h1>
        {liked && (
          <span className="pl__count">
            {liked.total} liked · {playlists.length} {playlists.length === 1 ? "playlist" : "playlists"}
          </span>
        )}
      </header>

      {sp.spotify_error && (
        <p className="lib__notice lib__notice--error" role="alert">
          {connectErrorText(sp.spotify_error)}
        </p>
      )}
      {sp.spotify === "connected" && (
        <p className="lib__notice" role="status">
          Spotify connected. Your library is syncing; refresh in a minute.
        </p>
      )}

      <SpotifyControls
        connected={status !== null}
        revoked={status?.status === "revoked"}
        line={status ? spotifyStatusLine(status, now) : null}
        error={syncError}
      />

      {liked && (
        <>
          <section className="lib__section">
            <div className="eyebrow">Liked songs</div>
            {liked.songs.length === 0 ? (
              <p className="muted">Nothing yet.</p>
            ) : (
              <>
                <SongList songs={liked.songs} now={now} />
                {liked.total > liked.songs.length && (
                  <p className="muted">and {liked.total - liked.songs.length} more</p>
                )}
              </>
            )}
          </section>

          <section className="lib__section">
            <div className="eyebrow">Playlists</div>
            {playlists.length === 0 ? (
              <p className="muted">
                No playlists yet. Only playlists you made or collaborate on come across.
              </p>
            ) : (
              <ul className="pl__grid">
                {playlists.map((p) => (
                  <li key={p.id} className="pl__item">
                    <div className={`pl__cover${p.artworkUrl ? "" : " pl__cover--empty"}`}>
                      {p.artworkUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.artworkUrl} alt="" loading="lazy" />
                      ) : (
                        <span aria-hidden="true">♪</span>
                      )}
                    </div>
                    <div className="pl__meta">
                      <div className="pl__name" title={p.name}>
                        {p.name}
                      </div>
                      <div className="pl__sub">
                        {p.songCount} {p.songCount === 1 ? "song" : "songs"}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="lib__section">
            <div className="eyebrow">Recently played on Spotify</div>
            {listens.length === 0 ? (
              <p className="muted">Nothing yet.</p>
            ) : (
              <SongList songs={listens} now={now} />
            )}
          </section>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 4: Add the styles and the link**

In `app/globals.css`, insert this block immediately before the line `/* ---- Motion ---- */`:

```css
/* ---- Library ---- */
.lib__connect,
.lib__status {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-bottom: var(--space-7);
}
.lib__line {
  color: var(--muted);
  font-size: var(--text-body);
}
.lib__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.lib__notice {
  color: var(--muted);
  font-size: var(--text-body);
  margin-bottom: var(--space-4);
}
.lib__notice--error {
  color: var(--danger);
}
.lib__section {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  margin-bottom: var(--space-8);
}

```

In `app/page.tsx`, add a Library link before Friends in the account bar:

```tsx
            <a href="/library" className="btn btn--sm">
              Library
            </a>
            <a href="/friends" className="btn btn--sm">
              Friends
            </a>
```

- [ ] **Step 5: Verify**

Run: `npm test && npm run typecheck && npm run build`
Expected: every suite passes (including `test/design/tokens.test.ts`), no type errors, build succeeds with `/library` listed.

Run `npm run dev`, sign in at `http://127.0.0.1:3000` (Setup item 3 must be done for Google sign-in to return to 127.0.0.1; if it isn't, use `http://localhost:3000` for this step only), and open `/library`.
Expected: "Your library", the connect paragraph and a **Connect Spotify** button, no errors in the terminal. Open `/library?spotify_error=not_approved`.
Expected: the red line `Spotify hasn't approved this account for june yet — ask Jacob to add it.` The home page account bar shows **Library** before **Friends**. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spotify/library.ts src/lib/spotify/actions.ts app/library app/page.tsx app/globals.css
git commit -m "Add the library page

Shows the Spotify connection with its last sync or last error, liked songs,
playlists you made or collaborate on, and recent Spotify plays. Sync now,
Disconnect (the library stays) and Disconnect and delete act on the signed-in
user alone. Linked from the home page's account bar."
git push
```

---

### Task 10: Docs and env

**Files:**
- Modify: `.env.local.example`, `README.md`, `docs/ARCHITECTURE.md`

- [ ] **Step 1: Add the env vars to the example**

Append to `.env.local.example`:

```bash

# Spotify library (server-only). From the app at developer.spotify.com/dashboard,
# whose redirect URIs must include http://127.0.0.1:3000/api/spotify/callback —
# Spotify rejects localhost, so work on this feature at 127.0.0.1.
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
# Bearer secret for POST /api/spotify/sync. The same value lives in Supabase
# Vault as spotify_sync_secret, where the cron job reads it.
SPOTIFY_SYNC_SECRET=
```

- [ ] **Step 2: Add them to the README's env table**

In `README.md`, add two rows to the table under "Local development", after the `SIGNUP_CAP` row:

```markdown
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Spotify library: the Development Mode app (five users) |
| `SPOTIFY_SYNC_SECRET` | Bearer secret for the cron-driven Spotify sync |
```

And add a feature bullet after **Your listening**:

```markdown
- **Spotify library** — connect Spotify to bring in liked songs, your own
  playlists, recent plays and top artists, synced every 30 minutes. Spotify's
  Development Mode limits this to five accounts.
```

- [ ] **Step 3: Document the flow in the architecture doc**

In `docs/ARCHITECTURE.md`, add this section after "## Data model (Supabase)" and before "## Environments and secrets":

```markdown
## Spotify library

Spec: `docs/superpowers/specs/2026-09-25-spotify-library-design.md`.

A user connects Spotify from `/library` (authorization code flow;
`/api/spotify/connect` → Spotify → `/api/spotify/callback`). The app is in
Spotify's **Development Mode: five users at most**, each added by email in the
developer dashboard, and the owner must hold Premium. Anyone not added gets a
403 from `GET /me`, which the callback turns into its own message.

pg_cron calls `POST /api/spotify/sync` every 30 minutes through pg_net, with a
bearer secret read from Vault (`spotify_sync_secret`). The route answers 202
and syncs in `after()`. A lease (`claim_spotify_sync`) keeps runs from
overlapping. Per user: refresh the token, read plays after `recent_cursor`
(Spotify keeps only the last 50, so a run logs any gap), read likes back to
the newest stored, re-read owned and collaborative playlists whose
`snapshot_id` changed, and once a day re-read every like (to drop unlikes)
and the top lists. A 429 ends the run for everyone: quota is counted per
developer account.

Tables: `songs` (shared, one row per Spotify track), `library_songs`,
`playlists` + `playlist_songs`, `listens` (plays outside june; `plays` stays
"heard in a june room"), `taste_snapshots`, and `spotify_connections`
(service-role only; the owner reads status through `my_spotify_connection()`).
All writes are service-role. Pure logic is in `src/spotify/` and
`src/lib/spotify/sync-user.ts`; IO in `src/lib/spotify/{store,connection,sync}.ts`.
```

In the same file, under "## Environments and secrets", add to the june table:

```markdown
| `SPOTIFY_CLIENT_ID` / `_SECRET` | Spotify library OAuth |
| `SPOTIFY_SYNC_SECRET` | cron → `/api/spotify/sync` bearer; also in Vault |
```

- [ ] **Step 4: Commit**

```bash
git add .env.local.example README.md docs/ARCHITECTURE.md
git commit -m "Document the Spotify library

The env vars, the five-user Development Mode limit, and how the connect flow
and the cron-driven sync fit together."
git push
```

---

### Task 11: End to end with a real account

This task needs Setup items 1–3. If `SPOTIFY_CLIENT_ID` is missing from `.env.local`, stop and ask the user to do them.

**Files:**
- Modify (only if a live response doesn't match): `src/spotify/schema.ts`, `test/spotify/schema.test.ts`

- [ ] **Step 1: Connect**

Run: `npm run dev`. At `http://127.0.0.1:3000`, sign in with Google, open `/library`, press **Connect Spotify**, approve on Spotify.
Expected: back on `/library?spotify=connected` with "Spotify connected. Your library is syncing".

- [ ] **Step 2: Check the first sync**

Wait about a minute and refresh `/library`.
Expected: "Connected to Spotify as <name> · last synced …", liked songs, your playlists, and recent plays; no red error line. The dev server terminal shows no `Spotify sync failed` line.

If the page shows "Last sync failed … ZodError" (or similar), Spotify's live shape differs from the schema. Copy the failing field path from the error, add a test case with that exact shape to `test/spotify/schema.test.ts`, confirm it fails, fix `src/spotify/schema.ts`, confirm it passes, and press **Sync now**.

Confirm the rows with the Supabase MCP `execute_sql` tool:

```sql
select
  (select count(*) from public.library_songs) as likes,
  (select count(*) from public.playlists) as playlists,
  (select count(*) from public.playlist_songs) as playlist_songs,
  (select count(*) from public.listens) as listens,
  (select count(*) from public.taste_snapshots) as taste,
  (select count(*) from public.songs where match_state = 'pending') as pending_songs;
```

Expected: every count above zero (taste = 6), matching roughly what the page shows.

- [ ] **Step 3: Incremental sync**

Like a new song in the Spotify app, play any song for more than 30 seconds, then wait a minute past the last sync and press **Sync now**.
Expected: "Synced."; the new like is first under Liked songs and the play is first under Recently played.

- [ ] **Step 4: Unlike via the daily pass**

Unlike that song in Spotify. Force the daily pass (yours is the only connection at this point):

```sql
update public.spotify_connections
set last_daily_sync_at = now() - interval '25 hours', last_synced_at = null;
```

Press **Sync now**.
Expected: the unliked song is gone from Liked songs.

- [ ] **Step 5: Error paths**

- Open `/api/spotify/callback?state=bogus&code=x` while signed in.
  Expected: `/library` shows "That connection link expired or came from another session."
- If you have a second Spotify account that is *not* in the dashboard's User Management: Disconnect, sign into Spotify as that account in the browser, press Connect Spotify.
  Expected: `Spotify hasn't approved this account for june yet — ask Jacob to add it.`, and no row in `spotify_connections`. Then reconnect your own account.
- Press **Disconnect**.
  Expected: the connect paragraph returns, and the counts query from Step 2 returns the same numbers: disconnecting drops only the tokens. Reconnect.

- [ ] **Step 6: Run everything and commit any schema fix**

Run: `npm test && npm run typecheck`
Expected: all pass.

If Step 2 needed a schema fix:

```bash
git add src/spotify/schema.ts test/spotify/schema.test.ts
git commit -m "Match the Spotify schema to what the live API returns"
git push
```

In the commit body, name the field and what Spotify actually returned.

Stop the dev server.

---

### Task 12: Pull request, then the cron job

**Files:**
- Create: `supabase/migrations/20260925000100_spotify_sync_cron.sql`

- [ ] **Step 1: Write the cron migration (not applied yet)**

Create `supabase/migrations/20260925000100_spotify_sync_cron.sql`:

```sql
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
```

- [ ] **Step 2: Commit and open the PR**

```bash
git add supabase/migrations/20260925000100_spotify_sync_cron.sql
git commit -m "Schedule the Spotify sync every 30 minutes

pg_cron posts to /api/spotify/sync through pg_net with a bearer secret read
from Vault. Applied after the route is live in production."
git push
```

Take a screenshot of `/library` with a synced library (dev server, 1280px wide), save it as `docs/pr-media/spotify-library.png`, commit and push it:

```bash
git add docs/pr-media/spotify-library.png
git commit -m "Add a screenshot of the library page for the PR"
git push
```

Open the PR from `spotify-library` into `main` with `gh pr create`. Title: `Connect Spotify and keep a library in june`. Body — what changed and why, nothing else:

```markdown
Adds a Spotify connection and a `/library` page. A connected user's liked
songs, own and collaborative playlists, recent plays and top artists/tracks
sync into Supabase every 30 minutes.

- Spotify's Development Mode caps the app at five users; each is added by
  email in the developer dashboard, and an account that isn't gets its own
  message at connect time.
- New tables: shared `songs`, owner-only `library_songs`, `playlists` +
  `playlist_songs`, `listens`, `taste_snapshots`, and service-role-only
  `spotify_connections`. The schema migration is already applied (the project
  shares one database); the cron migration is applied after this merges.
- The sync decisions are pure and tested with in-memory fakes; the pg_cron
  job calls `POST /api/spotify/sync` with a bearer secret from Vault.
- Phase 1 of `docs/superpowers/specs/2026-09-25-spotify-library-design.md`.
  Matching songs to audio and queueing them in rooms come next.

![The library page](https://github.com/JacobTDang/june/blob/spotify-library/docs/pr-media/spotify-library.png?raw=true)
```

Tell the user the PR URL and that Setup items 4 and 5 (Vercel env vars, Vault secret) must be done before merging.

- [ ] **Step 3: After the user merges — apply the cron job**

Wait for the user to confirm the PR is merged and Vercel has deployed `main`. Then confirm the route is live:

Run: `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://june-jam.vercel.app/api/spotify/sync`
Expected: `401` (a `404` means the deploy isn't live yet; a `500` means `SPOTIFY_SYNC_SECRET` is missing in Vercel).

Confirm the Vault secret exists (the value is not shown):

```sql
select count(*) as present from vault.decrypted_secrets where name = 'spotify_sync_secret';
```

Expected: `present = 1`. If 0, stop and ask the user to do Setup item 5.

Apply the migration with the Supabase MCP `apply_migration` tool, name `spotify_sync_cron`, query = the file's contents. Then:

```sql
select jobname, schedule, active from cron.job where jobname = 'spotify-sync';
```

Expected: one row, `*/30 * * * *`, `active = true`.

- [ ] **Step 4: Verify the first scheduled run**

After the next :00 or :30:

```sql
select status_code, content::text, created
from net._http_response
order by created desc
limit 3;
```

Expected: the newest has `status_code = 202` and `{"accepted":true}`.

```sql
select last_synced_at, last_error from public.spotify_connections;
```

Expected: `last_synced_at` within the last few minutes, `last_error` null.

- [ ] **Step 5: Remove the PR screenshot**

The user asked that demo media not linger. On a new branch from `main`:

```bash
git checkout main && git pull
git checkout -b remove-pr-media
git rm docs/pr-media/spotify-library.png
git commit -m "Remove the library page screenshot used in the PR"
git push -u origin remove-pr-media
gh pr create --title "Remove the library page PR screenshot" --body "The screenshot was only for the Spotify library PR's description."
```

Tell the user the cron job is live and link the cleanup PR.
