import { describe, expect, it } from "vitest";
import {
  rowToNowPlaying,
  rowToParticipant,
  rowToQueueTrack,
} from "../../src/lib/room/types";

describe("rowToNowPlaying", () => {
  it("returns null when nothing is playing", () => {
    expect(
      rowToNowPlaying({
        id: "r",
        now_playing_video_id: null,
        now_playing_title: null,
        now_playing_artist: null,
        now_playing_duration_ms: null,
        now_playing_thumbnail_url: null,
        now_playing_started_at: null,
        now_playing_added_by_name: null,
      }),
    ).toBeNull();
  });

  it("maps a playing row to the shared clock shape", () => {
    expect(
      rowToNowPlaying({
        id: "r",
        now_playing_video_id: "v",
        now_playing_title: "T",
        now_playing_artist: "A",
        now_playing_duration_ms: 1000,
        now_playing_thumbnail_url: "th",
        now_playing_started_at: 5000,
        now_playing_added_by_name: "Bob",
      }),
    ).toEqual({
      videoId: "v",
      title: "T",
      artist: "A",
      durationMs: 1000,
      thumbnailUrl: "th",
      addedByName: "Bob",
      startedAt: 5000,
    });
  });
});

describe("rowToQueueTrack", () => {
  it("maps a queue row, turning nulls into undefined", () => {
    expect(
      rowToQueueTrack({
        id: "q",
        video_id: "v",
        title: "T",
        artist: null,
        duration_ms: 2000,
        thumbnail_url: null,
        added_by_name: "Bob",
      }),
    ).toEqual({ id: "q", videoId: "v", title: "T", durationMs: 2000, addedByName: "Bob" });
  });
});

describe("rowToParticipant", () => {
  it("defaults a null name to Guest", () => {
    expect(rowToParticipant({ user_id: "u", name: null })).toEqual({
      userId: "u",
      name: "Guest",
    });
  });
});
