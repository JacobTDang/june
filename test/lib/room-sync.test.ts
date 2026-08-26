import { describe, expect, it } from "vitest";
import { playbackCorrection, trackHasEnded } from "../../src/lib/room/sync";

const base = { durationMs: 275000, driftThresholdSeconds: 1.2 };

describe("playbackCorrection", () => {
  it("holds (never seeks) when the track is scheduled in the future", () => {
    // Regression: a future start time made expected negative, and the old code
    // seeked to max(0, expected) = 0 every tick → the song looped its first
    // second forever. It must wait instead.
    expect(playbackCorrection({ ...base, expectedSeconds: -68, actualSeconds: 2 })).toEqual({
      kind: "hold",
    });
  });

  it("advances once the shared clock passes the track's end", () => {
    expect(playbackCorrection({ ...base, expectedSeconds: 280, actualSeconds: 274 })).toEqual({
      kind: "advance",
    });
  });

  it("advances exactly at the end boundary", () => {
    expect(playbackCorrection({ ...base, expectedSeconds: 275, actualSeconds: 275 })).toEqual({
      kind: "advance",
    });
  });

  it("holds when the player is within the drift tolerance", () => {
    expect(playbackCorrection({ ...base, expectedSeconds: 100, actualSeconds: 100.5 })).toEqual({
      kind: "hold",
    });
  });

  it("seeks to the shared position when the player has drifted behind", () => {
    expect(playbackCorrection({ ...base, expectedSeconds: 100, actualSeconds: 90 })).toEqual({
      kind: "seek",
      toSeconds: 100,
    });
  });

  it("seeks to the shared position when the player has drifted ahead", () => {
    expect(playbackCorrection({ ...base, expectedSeconds: 100, actualSeconds: 112 })).toEqual({
      kind: "seek",
      toSeconds: 100,
    });
  });
});

describe("trackHasEnded", () => {
  const durationMs = 252_000;

  it("is false while the track is still running", () => {
    expect(
      trackHasEnded({ startedAt: 1_000_000, durationMs, nowMs: 1_000_000 + 100_000 }),
    ).toBe(false);
  });

  it("is true once the shared clock passes the duration", () => {
    expect(
      trackHasEnded({ startedAt: 1_000_000, durationMs, nowMs: 1_000_000 + durationMs }),
    ).toBe(true);
  });

  it("stays true long after the end, which is the stuck-room case", () => {
    expect(
      trackHasEnded({ startedAt: 1_000_000, durationMs, nowMs: 1_000_000 + 442_819 }),
    ).toBe(true);
  });

  it("is false when the clock has not started", () => {
    // A pending track has no elapsed time to run out - advancing it here
    // would skip a track nobody has heard.
    expect(trackHasEnded({ startedAt: null, durationMs, nowMs: 9_999_999 })).toBe(false);
  });

  it("is false when a bad offset puts the clock before the start", () => {
    expect(
      trackHasEnded({ startedAt: 1_000_000, durationMs, nowMs: 900_000 }),
    ).toBe(false);
  });

  it("is false for a track with no known duration", () => {
    // Duration 0 would otherwise read as "already over" and skip instantly.
    expect(trackHasEnded({ startedAt: 1_000_000, durationMs: 0, nowMs: 1_000_001 })).toBe(
      false,
    );
  });
});
