import { describe, expect, it } from "vitest";
import type { ImportStatus } from "../../src/audio/imports";
import {
  importBatch,
  matchResultUpdate,
  matchUpdateRow,
  updatesFromImport,
} from "../../src/lib/spotify/match-plan";

function status(tracks: ImportStatus["tracks"]): ImportStatus {
  return { id: "job-1", status: "partial", total: tracks.length, done: tracks.length, tracks };
}

const resolved = (video: string, ms: number | null, confidence = "high") => ({
  title: "t",
  artist: "a",
  state: "resolved",
  video_id: video,
  matched_title: "t",
  confidence,
  matched_duration_ms: ms,
});

describe("importBatch", () => {
  it("sends each song's title, first artist and Spotify length", () => {
    expect(
      importBatch([
        { id: "s1", title: "Glory Box", artists: ["Portishead", "Guest"], durationMs: 305_000 },
        { id: "s2", title: "Roads", artists: ["Portishead"], durationMs: null },
      ]),
    ).toEqual([
      { title: "Glory Box", artist: "Portishead", durationMs: 305_000 },
      { title: "Roads", artist: "Portishead", durationMs: null },
    ]);
  });

  it("refuses a song with no artist rather than sending a blank one", () => {
    expect(() => importBatch([{ id: "s1", title: "X", artists: [], durationMs: null }])).toThrow(/s1/);
  });
});

describe("updatesFromImport", () => {
  const songs = [
    { id: "s1", position: 0 },
    { id: "s2", position: 1 },
    { id: "s3", position: 2 },
    { id: "s4", position: 3 },
    { id: "s5", position: 4 },
  ];

  it("maps each position's result onto its song", () => {
    const updates = updatesFromImport(
      songs,
      status([
        resolved("v1", 306_000),
        resolved("v2", 200_000, "low"),
        { title: "t", artist: "a", state: "not_found" },
        { title: "t", artist: "a", state: "failed", error: "boom" },
        { title: "t", artist: "a", state: "canceled" },
      ]),
    );
    expect(updates).toEqual([
      { songId: "s1", state: "matched", videoId: "v1", videoDurationMs: 306_000, confidence: "high" },
      { songId: "s2", state: "matched", videoId: "v2", videoDurationMs: 200_000, confidence: "low" },
      { songId: "s3", state: "not_found" },
      { songId: "s4", state: "failed" },
      { songId: "s5", state: "pending" },
    ]);
  });

  it("leaves songs whose track is still pending alone", () => {
    const updates = updatesFromImport(
      [{ id: "s1", position: 0 }],
      status([{ title: "t", artist: "a", state: "pending" }]),
    );
    expect(updates).toEqual([]);
  });

  it("treats a match with no video length as failed, since it can't be timed", () => {
    expect(updatesFromImport([{ id: "s1", position: 0 }], status([resolved("v1", null)]))).toEqual([
      { songId: "s1", state: "failed" },
    ]);
  });

  it("sends every song back to pending when the import is gone", () => {
    expect(updatesFromImport(songs.slice(0, 2), null)).toEqual([
      { songId: "s1", state: "pending" },
      { songId: "s2", state: "pending" },
    ]);
  });

  it("fails loudly when a position is missing from the import", () => {
    expect(() => updatesFromImport([{ id: "s9", position: 7 }], status([resolved("v1", 1000)]))).toThrow(
      /position 7/,
    );
  });
});

describe("matchResultUpdate", () => {
  it("maps a resolved match", () => {
    expect(
      matchResultUpdate("s1", { state: "resolved", video_id: "v1", matched_title: "t", confidence: "high", matched_duration_ms: 306_000 }),
    ).toEqual({ songId: "s1", state: "matched", videoId: "v1", videoDurationMs: 306_000, confidence: "high" });
  });

  it("maps not found, and a resolved match without a length, to not playable", () => {
    expect(matchResultUpdate("s1", { state: "not_found" })).toEqual({ songId: "s1", state: "not_found" });
    expect(
      matchResultUpdate("s1", { state: "resolved", video_id: "v1", matched_duration_ms: null }),
    ).toEqual({ songId: "s1", state: "failed" });
  });
});

describe("matchUpdateRow", () => {
  it("writes the video fields only for a match", () => {
    expect(
      matchUpdateRow({ songId: "s1", state: "matched", videoId: "v1", videoDurationMs: 306_000, confidence: "low" }),
    ).toEqual({ song_id: "s1", state: "matched", video_id: "v1", video_duration_ms: 306_000, confidence: "low" });
    expect(matchUpdateRow({ songId: "s2", state: "not_found" })).toEqual({
      song_id: "s2",
      state: "not_found",
      video_id: null,
      video_duration_ms: null,
      confidence: null,
    });
  });
});
