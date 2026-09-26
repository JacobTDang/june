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
