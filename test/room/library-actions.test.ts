import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SongForRoom } from "../../src/lib/room/library-rows";
import { fakeSupabase } from "./fake-supabase";

// library.ts is server code; its guards only resolve under Next's server build.
vi.mock("server-only", () => ({}));

const supabase = vi.hoisted(() => ({ current: null as unknown }));
const enqueueMany = vi.hoisted(() => vi.fn());

vi.mock("../../src/lib/supabase/server", () => ({ createClient: async () => supabase.current }));
vi.mock("../../src/lib/room/enqueue-many", () => ({ enqueueMany }));
vi.mock("../../src/lib/room/actions", () => ({ enqueueTrack: vi.fn() }));
vi.mock("../../src/lib/spotify/library", () => ({ getLibraryPlaylists: vi.fn() }));
vi.mock("../../src/lib/spotify/match-store", () => ({ supabaseMatchStore: vi.fn() }));
vi.mock("../../src/lib/spotify/config", () => ({ mp3serverServiceConfig: vi.fn() }));
vi.mock("../../src/audio/imports", () => ({ createImportService: vi.fn() }));

import { queueLibraryPlaylist } from "../../src/lib/room/library";

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
