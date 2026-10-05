import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SongForRoom } from "../../src/lib/room/library-rows";
import { fakeSupabase } from "./fake-supabase";

// library.ts is server code; its guards only resolve under Next's server build.
vi.mock("server-only", () => ({}));

const supabase = vi.hoisted(() => ({ current: null as unknown }));
const enqueueMany = vi.hoisted(() => vi.fn());
const enqueueTrack = vi.hoisted(() => vi.fn());
const matchOne = vi.hoisted(() => vi.fn());
const applyUpdates = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/supabase/server", () => ({ createClient: async () => supabase.current }));
vi.mock("../../src/lib/room/enqueue-many", () => ({ enqueueMany }));
vi.mock("../../src/lib/room/actions", () => ({ enqueueTrack }));
vi.mock("../../src/lib/spotify/library", () => ({ getLibraryPlaylists: vi.fn() }));
vi.mock("../../src/lib/spotify/match-store", () => ({ supabaseMatchStore: () => ({ applyUpdates }) }));
vi.mock("../../src/lib/spotify/config", () => ({ mp3serverServiceConfig: () => ({}) }));
vi.mock("../../src/audio/imports", () => ({ createImportService: () => ({ matchOne }) }));

import { queueLibraryPlaylist, queueLibrarySong } from "../../src/lib/room/library";

const song = (id: string, over: Partial<SongForRoom> = {}): SongForRoom => ({
  id,
  title: `Song ${id}`,
  artists: ["Artist"],
  artwork_url: null,
  duration_ms: 200_000,
  match_state: "matched",
  video_id: `video-${id}`,
  video_duration_ms: 201_000,
  match_confidence: "high",
  ...over,
});

const inPlaylist = (...songs: SongForRoom[]) => songs.map((s, position) => ({ position, songs: s }));

function signedIn(tables: Record<string, unknown[]>) {
  const fake = fakeSupabase(tables);
  supabase.current = fake.client;
  return fake;
}

beforeEach(() => {
  for (const fn of [enqueueTrack, matchOne, applyUpdates]) fn.mockReset();
  enqueueMany.mockReset();
  enqueueMany.mockImplementation(async (_roomId: string, tracks: unknown[]) => tracks.length);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("queueLibraryPlaylist", () => {
  it("queues a video once when two songs matched to it", async () => {
    signedIn({ playlist_songs: inPlaylist(song("a"), song("b", { video_id: "video-a" }), song("c")) });

    const result = await queueLibraryPlaylist("room-1", "playlist-1");

    expect(enqueueMany).toHaveBeenCalledTimes(1);
    const queued = enqueueMany.mock.calls[0]?.[1] as { videoId: string; title: string }[];
    expect(queued.map((t) => [t.videoId, t.title])).toEqual([
      ["video-a", "Song a"],
      ["video-c", "Song c"],
    ]);
    expect(result).toEqual({ ok: true, data: "Added 2" });
  });

  it("counts a shared video once toward what is already in the room", async () => {
    signedIn({ playlist_songs: inPlaylist(song("a"), song("b", { video_id: "video-a" }), song("c")) });
    enqueueMany.mockResolvedValue(1);

    const result = await queueLibraryPlaylist("room-1", "playlist-1");

    expect(result).toEqual({ ok: true, data: "Added 1 · 1 already in the room" });
  });

  it("says a playlist that isn't the caller's isn't in their library", async () => {
    const { argsOf } = signedIn({ playlist_songs: [], playlists: [] });

    const result = await queueLibraryPlaylist("room-1", "someone-elses");

    expect(result).toEqual({ ok: false, notice: "That playlist isn't in your library." });
    expect(argsOf("playlists", "eq")).toContainEqual(["id", "someone-elses"]);
    expect(enqueueMany).not.toHaveBeenCalled();
  });

  it("says one of the caller's playlists with no songs has none yet", async () => {
    signedIn({ playlist_songs: [], playlists: [{ id: "playlist-1" }] });

    const result = await queueLibraryPlaylist("room-1", "playlist-1");

    expect(result).toEqual({ ok: false, notice: "That playlist has no songs yet." });
    expect(enqueueMany).not.toHaveBeenCalled();
  });

  it("only checks who owns the playlist when it has no songs", async () => {
    const { argsOf } = signedIn({ playlist_songs: inPlaylist(song("a", { match_state: "pending", video_id: null })) });

    const result = await queueLibraryPlaylist("room-1", "playlist-1");

    expect(result).toEqual({ ok: true, data: "Added 0 · 1 still matching" });
    expect(argsOf("playlists", "select")).toEqual([]);
  });
});

describe("queueLibrarySong", () => {
  /** A song the caller has liked, as RLS would show it to them. */
  function liked(over: Partial<SongForRoom>) {
    const row = song("a", over);
    return signedIn({ library_songs: [{ song_id: "a" }], playlist_songs: [], songs: [row] });
  }

  const pending = { match_state: "pending", video_id: null, video_duration_ms: null };
  const noMatch = "No playable match was found for “Song a”.";

  it("queues a ready song", async () => {
    liked({});

    const result = await queueLibrarySong("room-1", "a");

    expect(result).toEqual({ ok: true, data: "Added “Song a”" });
    expect(enqueueTrack).toHaveBeenCalledWith("room-1", expect.objectContaining({ videoId: "video-a" }));
  });

  it("marks a song that is already known to have no match as unavailable", async () => {
    liked({ match_state: "not_found", video_id: null, video_duration_ms: null });

    const result = await queueLibrarySong("room-1", "a");

    expect(result).toEqual({ ok: false, notice: noMatch, rowState: "unavailable" });
    expect(matchOne).not.toHaveBeenCalled();
  });

  it("marks a song unavailable when matching it now finds nothing", async () => {
    liked(pending);
    matchOne.mockResolvedValue({ state: "not_found" });

    const result = await queueLibrarySong("room-1", "a");

    expect(result).toEqual({ ok: false, notice: noMatch, rowState: "unavailable" });
    expect(applyUpdates).toHaveBeenCalledWith([{ songId: "a", state: "not_found" }]);
    expect(enqueueTrack).not.toHaveBeenCalled();
  });

  it("marks a song failed, not unavailable, when the match comes back without a video", async () => {
    liked(pending);
    matchOne.mockResolvedValue({ state: "resolved", video_id: null });

    const result = await queueLibrarySong("room-1", "a");

    expect(result).toEqual({
      ok: false,
      notice: "Couldn’t match “Song a” just now. It’s still in line to be matched; try again later.",
      rowState: "failed",
    });
    expect(applyUpdates).toHaveBeenCalledWith([{ songId: "a", state: "failed" }]);
    expect(enqueueTrack).not.toHaveBeenCalled();
  });

  it("marks a song failed when it can't be sent for matching", async () => {
    liked({ ...pending, artists: [] });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await queueLibrarySong("room-1", "a");

    expect(result).toEqual({
      ok: false,
      notice: "That song can’t be matched because its title or artist is missing.",
      rowState: "failed",
    });
    expect(applyUpdates).toHaveBeenCalledWith([{ songId: "a", state: "failed" }]);
    expect(matchOne).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("leaves the row as it was when matching times out", async () => {
    liked(pending);
    matchOne.mockRejectedValue(new Error("timed out"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await queueLibrarySong("room-1", "a");

    expect(result).toEqual({
      ok: false,
      notice: "Couldn’t match “Song a” just now. It’s still in line to be matched; try again later.",
    });
    expect(result).not.toHaveProperty("rowState");
    expect(applyUpdates).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("leaves the row as it was for a song that isn't in the library", async () => {
    signedIn({ library_songs: [], playlist_songs: [], songs: [song("a")] });

    const result = await queueLibrarySong("room-1", "a");

    expect(result).toEqual({ ok: false, notice: "That song isn't in your library." });
    expect(result).not.toHaveProperty("rowState");
  });
});
