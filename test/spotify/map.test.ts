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
