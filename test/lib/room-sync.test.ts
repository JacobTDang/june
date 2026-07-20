import { describe, expect, it } from "vitest";
import { playbackCorrection } from "../../src/lib/room/sync";

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
