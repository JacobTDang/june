import { describe, expect, it } from "vitest";
import {
  readPlaybackMode,
  shouldPlayHere,
  type PlaybackMode,
} from "../../src/lib/room/playback-mode";

describe("readPlaybackMode", () => {
  it("defaults to playing when nothing is stored", () => {
    expect(readPlaybackMode(null)).toBe("play");
  });

  it("keeps a stored choice", () => {
    expect(readPlaybackMode("silent")).toBe("silent");
    expect(readPlaybackMode("play")).toBe("play");
  });

  it("falls back to playing on a value it doesn't recognise", () => {
    // Storage is user-writable and survives across versions; an unknown value
    // must not leave a device silently muted with no explanation.
    expect(readPlaybackMode("something-else")).toBe("play");
    expect(readPlaybackMode("")).toBe("play");
  });
});

describe("shouldPlayHere", () => {
  const cases: { mode: PlaybackMode; started: boolean; hasTrack: boolean; expected: boolean }[] = [
    { mode: "play", started: true, hasTrack: true, expected: true },
    { mode: "silent", started: true, hasTrack: true, expected: false },
    { mode: "play", started: false, hasTrack: true, expected: false },
    { mode: "play", started: true, hasTrack: false, expected: false },
  ];

  it("plays only once the listener has tapped in, chose to play here, and there is a track", () => {
    for (const { mode, started, hasTrack, expected } of cases) {
      expect(shouldPlayHere(mode, started, hasTrack)).toBe(expected);
    }
  });
});
