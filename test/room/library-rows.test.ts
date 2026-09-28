import { describe, expect, it } from "vitest";
import {
  matchView,
  playlistQueueSummary,
  rowMatchesFilter,
  rowNote,
  toLibraryRow,
  trackFromSong,
  type SongForRoom,
} from "../../src/lib/room/library-rows";

const song = (over: Partial<SongForRoom> = {}): SongForRoom => ({
  id: "s1",
  title: "Glory Box",
  artists: ["Portishead", "Guest"],
  artwork_url: "https://i.scdn.co/image/x",
  duration_ms: 305_000,
  match_state: "matched",
  video_id: "v1",
  video_duration_ms: 306_000,
  match_confidence: "high",
  ...over,
});

describe("toLibraryRow", () => {
  it("shows a matched song as ready", () => {
    expect(toLibraryRow(song())).toEqual({
      songId: "s1",
      title: "Glory Box",
      artists: "Portishead, Guest",
      artworkUrl: "https://i.scdn.co/image/x",
      state: "ready",
      lowConfidence: false,
    });
  });

  it("flags a low-confidence match", () => {
    expect(toLibraryRow(song({ match_confidence: "low" })).lowConfidence).toBe(true);
  });

  it("shows pending and matching songs as matching", () => {
    expect(toLibraryRow(song({ match_state: "pending", video_id: null, video_duration_ms: null })).state).toBe("matching");
    expect(toLibraryRow(song({ match_state: "matching", video_id: null, video_duration_ms: null })).state).toBe("matching");
  });

  it("shows not found, failed, and a matched song missing its video as unavailable", () => {
    expect(toLibraryRow(song({ match_state: "not_found" })).state).toBe("unavailable");
    expect(toLibraryRow(song({ match_state: "failed" })).state).toBe("unavailable");
    expect(toLibraryRow(song({ video_duration_ms: null })).state).toBe("unavailable");
  });
});

describe("trackFromSong", () => {
  it("queues a ready song with the video's own length and Spotify's text and art", () => {
    expect(trackFromSong(song())).toEqual({
      videoId: "v1",
      title: "Glory Box",
      artist: "Portishead, Guest",
      durationMs: 306_000,
      thumbnailUrl: "https://i.scdn.co/image/x",
    });
  });

  it("has nothing to queue for a song that isn't ready", () => {
    expect(trackFromSong(song({ match_state: "pending", video_id: null, video_duration_ms: null }))).toBeNull();
    expect(trackFromSong(song({ artwork_url: null }))?.thumbnailUrl).toBeUndefined();
  });
});

describe("rowNote", () => {
  it("uses the spec's copy", () => {
    expect(rowNote({ state: "ready", lowConfidence: false })).toBe("");
    expect(rowNote({ state: "ready", lowConfidence: true })).toBe(" · ?");
    expect(rowNote({ state: "matching", lowConfidence: false })).toBe(" · matching…");
    expect(rowNote({ state: "unavailable", lowConfidence: false })).toBe(" · no match found");
  });

  it("works from just a song's match columns, as /library reads them", () => {
    expect(
      rowNote(matchView({ match_state: "pending", video_id: null, video_duration_ms: null, match_confidence: null })),
    ).toBe(" · matching…");
  });
});

describe("rowMatchesFilter", () => {
  const row = toLibraryRow(song({ title: "Déjà Vu", artists: ["Beyoncé"] }));

  it("matches title or artists, ignoring case and accents", () => {
    expect(rowMatchesFilter(row, "deja")).toBe(true);
    expect(rowMatchesFilter(row, "BEYONCE")).toBe(true);
    expect(rowMatchesFilter(row, "  vu ")).toBe(true);
    expect(rowMatchesFilter(row, "glory")).toBe(false);
  });

  it("matches everything for an empty filter", () => {
    expect(rowMatchesFilter(row, "   ")).toBe(true);
  });
});

describe("playlistQueueSummary", () => {
  it("says what was added and what was left out", () => {
    expect(playlistQueueSummary({ added: 38, ready: 38, matching: 3, unavailable: 1 })).toBe(
      "Added 38 · 3 still matching · 1 not found",
    );
  });

  it("mentions songs that were already in the room", () => {
    expect(playlistQueueSummary({ added: 5, ready: 7, matching: 0, unavailable: 0 })).toBe(
      "Added 5 · 2 already in the room",
    );
  });

  it("is plain when everything went in", () => {
    expect(playlistQueueSummary({ added: 12, ready: 12, matching: 0, unavailable: 0 })).toBe("Added 12");
  });
});
