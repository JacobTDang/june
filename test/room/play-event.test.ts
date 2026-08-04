import { describe, expect, it } from "vitest";
import {
  MIN_LISTENED_MS,
  groupPastJams,
  playEvent,
  topArtists,
  type PlayRow,
} from "../../src/lib/room/play-event";

const TRACK = {
  videoId: "abc12345678",
  title: "Glory Box",
  artist: "Portishead",
  thumbnailUrl: "https://img/1.jpg",
  durationMs: 212_000,
  startedAt: 1_000_000,
};

describe("playEvent", () => {
  it("records how long the room actually heard it", () => {
    const event = playEvent({ track: TRACK, endedAt: 1_000_000 + 90_000, skipped: true });
    expect(event?.listenedMs).toBe(90_000);
  });

  it("never reports listening past the end of the track", () => {
    // The room can sit on a finished track: nobody advances it until a client
    // notices. That overhang isn't listening.
    const event = playEvent({ track: TRACK, endedAt: 1_000_000 + 500_000, skipped: false });
    expect(event?.listenedMs).toBe(TRACK.durationMs);
  });

  it("carries the skip flag through, since that is the signal worth having", () => {
    expect(playEvent({ track: TRACK, endedAt: 1_060_000, skipped: true })?.skipped).toBe(true);
    expect(playEvent({ track: TRACK, endedAt: 1_212_000, skipped: false })?.skipped).toBe(false);
  });

  it("ignores a track nobody really heard", () => {
    // Skipping within a few seconds says "not this one", not "I listened to
    // this" — recording it would poison both history and recommendations.
    expect(playEvent({ track: TRACK, endedAt: 1_000_000 + 1_500, skipped: true })).toBeNull();
    expect(playEvent({ track: TRACK, endedAt: 1_000_000 + MIN_LISTENED_MS, skipped: true })).not.toBeNull();
  });

  it("ignores a track that never started", () => {
    // startedAt is null while a track is still downloading: it was queued and
    // then removed without ever playing.
    expect(playEvent({ track: { ...TRACK, startedAt: null }, endedAt: 1_100_000, skipped: true })).toBeNull();
  });

  it("treats a clock that runs backwards as no listening", () => {
    expect(playEvent({ track: TRACK, endedAt: 999_000, skipped: true })).toBeNull();
  });
});

function row(over: Partial<PlayRow>): PlayRow {
  return {
    roomId: "T8P-W5Z",
    videoId: "v1",
    title: "A song",
    artist: "An artist",
    thumbnailUrl: null,
    playedAt: "2026-08-04T10:00:00Z",
    userId: "me",
    userName: "Uso",
    ...over,
  };
}

describe("topArtists", () => {
  it("ranks by how often each artist was played", () => {
    const ranked = topArtists([
      row({ artist: "Portishead" }),
      row({ artist: "Mitski" }),
      row({ artist: "Portishead" }),
    ]);
    expect(ranked[0]).toEqual({ artist: "Portishead", plays: 2 });
    expect(ranked[1]).toEqual({ artist: "Mitski", plays: 1 });
  });

  it("treats the same artist written differently as one", () => {
    const ranked = topArtists([row({ artist: "Mitski" }), row({ artist: "  mitski " })]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]!.plays).toBe(2);
    // Keeps the first spelling seen rather than the normalised one.
    expect(ranked[0]!.artist).toBe("Mitski");
  });

  it("skips plays with no artist rather than inventing one", () => {
    // Pasted links and playlist imports often carry only a channel name.
    expect(topArtists([row({ artist: null }), row({ artist: "" })])).toEqual([]);
  });

  it("honours the limit", () => {
    const rows = ["a", "b", "c", "d"].map((artist) => row({ artist }));
    expect(topArtists(rows, 2)).toHaveLength(2);
  });
});

describe("groupPastJams", () => {
  it("groups a room's plays into one jam with its people and track count", () => {
    const jams = groupPastJams(
      [
        // Track one, heard by me alone; track two, heard by both of us — so
        // three rows across two tracks.
        row({ roomId: "AAA-111", videoId: "v1", playedAt: "2026-08-01T10:00:00Z", userId: "me", userName: "Uso" }),
        row({ roomId: "AAA-111", videoId: "v2", playedAt: "2026-08-01T10:04:00Z", userId: "u2", userName: "Esther" }),
        row({ roomId: "AAA-111", videoId: "v2", playedAt: "2026-08-01T10:04:00Z", userId: "me", userName: "Uso" }),
      ],
      "me",
    );

    expect(jams).toHaveLength(1);
    expect(jams[0]!.roomId).toBe("AAA-111");
    // Two distinct tracks were played, though three rows exist — one per listener.
    expect(jams[0]!.trackCount).toBe(2);
    // "With" means everyone but you.
    expect(jams[0]!.others).toEqual(["Esther"]);
  });

  it("orders jams with the most recent first", () => {
    const jams = groupPastJams(
      [
        row({ roomId: "OLD", playedAt: "2026-07-01T10:00:00Z" }),
        row({ roomId: "NEW", playedAt: "2026-08-01T10:00:00Z" }),
      ],
      "me",
    );
    expect(jams.map((j) => j.roomId)).toEqual(["NEW", "OLD"]);
  });

  it("keeps a jam you listened to alone", () => {
    const jams = groupPastJams([row({ roomId: "SOLO", userId: "me" })], "me");
    expect(jams[0]!.others).toEqual([]);
  });

  it("returns nothing for no plays", () => {
    expect(groupPastJams([], "me")).toEqual([]);
  });
});
