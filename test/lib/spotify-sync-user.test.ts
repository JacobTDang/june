import { describe, expect, it } from "vitest";
import {
  syncUser,
  type LibraryStore,
  type SyncInput,
  type SyncProgress,
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

/** Records what syncUser reports as each stage finishes. */
class FakeProgress implements SyncProgress {
  listens: { recentCursor: string | null; gap: { from: string; to: string } | null }[] = [];
  dailyPasses = 0;

  async listensSaved(recentCursor: string | null, gap: { from: string; to: string } | null) {
    this.listens.push({ recentCursor, gap });
  }
  async dailyPassSaved() {
    this.dailyPasses++;
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

/** An Error in place of a page or a playlist's items makes that call throw it. */
interface FakeData {
  recent?: RecentlyPlayedItem[];
  likedPages?: (SavedTracksPage | Error)[];
  playlists?: PlaylistSummary[];
  items?: Record<string, PlaylistItem[] | Error>;
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
      const page = data.likedPages?.[offset / 50] ?? { items: [], next: null };
      if (page instanceof Error) throw page;
      return page;
    },
    async myPlaylists() {
      return data.playlists ?? [];
    },
    async playlistItems(id) {
      calls.playlistItems.push(id);
      const items = data.items?.[id] ?? [];
      if (items instanceof Error) throw items;
      return items;
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

    const progress = new FakeProgress();
    const outcome = await syncUser(FIRST, client, store, progress, NOW);

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
    expect(progress.listens).toEqual([{ recentCursor: "2026-09-25T11:00:00.000Z", gap: null }]);
    expect(progress.dailyPasses).toBe(1);
  });

  it("asks Spotify only for plays after the cursor", async () => {
    const { client, calls } = fakeSpotify({});
    await syncUser(
      { ...LATER, recentCursor: "2026-09-25T10:00:00.000Z" },
      client,
      new FakeStore(),
      new FakeProgress(),
      NOW,
    );
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

    await syncUser(LATER, client, store, new FakeProgress(), NOW);

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
    await syncUser(FIRST, first, store, new FakeProgress(), NOW);

    const { client: later } = fakeSpotify({
      likedPages: [{ items: [{ added_at: "2026-09-22T00:00:00Z", track: track("kept") }], next: null }],
    });
    await syncUser(FIRST, later, store, new FakeProgress(), NOW);

    expect([...store.likes.keys()]).toEqual([store.songId("kept")]);
  });

  it("re-reads a playlist only when its snapshot changed, and forgets deleted ones", async () => {
    const store = new FakeStore();
    const { client: first } = fakeSpotify({
      playlists: [playlist("same", "me"), playlist("changed", "me"), playlist("gone", "me")],
    });
    await syncUser(LATER, first, store, new FakeProgress(), NOW);

    const { client, calls } = fakeSpotify({
      playlists: [playlist("same", "me", "s1"), playlist("changed", "me", "s2")],
      items: { changed: [{ added_at: null, item: track("x") }] },
    });
    await syncUser(LATER, client, store, new FakeProgress(), NOW);

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

    await syncUser(LATER, client, store, new FakeProgress(), NOW);

    expect(store.playlists.get("mine")?.songs).toEqual([{ songId: store.songId("real"), addedAt: null }]);
  });

  it("reports a possible gap when a full page of plays is newer than the cursor", async () => {
    const at = (minute: number) =>
      new Date(Date.parse("2026-09-25T10:00:00.000Z") + minute * 60_000).toISOString();
    const recent = Array.from({ length: 50 }, (_, i) => ({ track: track(`r${i}`), played_at: at(59 - i) }));
    const { client } = fakeSpotify({ recent });

    const progress = new FakeProgress();
    const outcome = await syncUser({ ...LATER, recentCursor: at(0) }, client, new FakeStore(), progress, NOW);

    expect(outcome.gap).toEqual({ from: at(0), to: at(10) });
    expect(outcome.recentCursor).toBe(at(59));
    expect(progress.listens).toEqual([{ recentCursor: at(59), gap: { from: at(0), to: at(10) } }]);
  });

  it("leaves taste alone between daily passes", async () => {
    const store = new FakeStore();
    const { client, calls } = fakeSpotify({ topArtists: [{ id: "ar1", name: "X" }] });

    const progress = new FakeProgress();
    const outcome = await syncUser(LATER, client, store, progress, NOW);

    expect(calls.topArtists).toBe(0);
    expect(store.taste).toEqual([]);
    expect(outcome.dailyDone).toBe(false);
    expect(progress.dailyPasses).toBe(0);
  });

  it("keeps the listens cursor and the daily pass when a playlist fails afterwards", async () => {
    const store = new FakeStore();
    const { client } = fakeSpotify({
      recent: [{ track: track("a"), played_at: "2026-09-25T11:00:00.000Z" }],
      likedPages: [{ items: [{ added_at: "2026-09-20T00:00:00Z", track: track("c") }], next: null }],
      playlists: [playlist("forbidden", "me")],
      items: { forbidden: new Error("Spotify answered 403") },
      topArtists: [{ id: "ar1", name: "X" }],
    });
    const progress = new FakeProgress();

    await expect(syncUser(FIRST, client, store, progress, NOW)).rejects.toThrow("Spotify answered 403");

    expect(progress.listens).toEqual([{ recentCursor: "2026-09-25T11:00:00.000Z", gap: null }]);
    expect(progress.dailyPasses).toBe(1);
    expect(store.taste).toHaveLength(6);
  });

  it("removes no likes on the daily pass when paging fails partway", async () => {
    const store = new FakeStore();
    const { client: first } = fakeSpotify({
      likedPages: [
        {
          items: [
            { added_at: "2026-09-22T00:00:00Z", track: track("a") },
            { added_at: "2026-09-21T00:00:00Z", track: track("b") },
          ],
          next: null,
        },
      ],
    });
    await syncUser(FIRST, first, store, new FakeProgress(), NOW);

    const { client, calls } = fakeSpotify({
      recent: [{ track: track("p"), played_at: "2026-09-25T11:00:00.000Z" }],
      likedPages: [
        {
          items: [{ added_at: "2026-09-22T00:00:00Z", track: track("a") }],
          next: "https://api.spotify.com/v1/me/tracks?offset=50",
        },
        new Error("Spotify answered 502"),
      ],
    });
    const progress = new FakeProgress();

    await expect(syncUser(FIRST, client, store, progress, NOW)).rejects.toThrow("Spotify answered 502");

    expect(calls.savedOffsets).toEqual([0, 50]);
    expect([...store.likes.keys()].sort()).toEqual([store.songId("a"), store.songId("b")].sort());
    expect(progress.listens).toEqual([{ recentCursor: "2026-09-25T11:00:00.000Z", gap: null }]);
    expect(progress.dailyPasses).toBe(0);
  });
});
