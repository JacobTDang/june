import { describe, expect, it } from "vitest";
import { playbackProgress } from "../../src/lib/room/progress";

describe("playbackProgress", () => {
  const clip = { startedAt: 1000, durationMs: 10000 };

  it("returns a deterministic zero before mount (now = null)", () => {
    // Server render and client hydration both pass now=null, so the result
    // must not depend on the wall clock — otherwise the two disagree and React
    // throws a hydration mismatch.
    expect(playbackProgress(null, 0, clip)).toEqual({ position: 0, pct: 0 });
    expect(playbackProgress(null, 500, clip)).toEqual({ position: 0, pct: 0 });
  });

  it("computes elapsed position from the client clock", () => {
    // now=6000 → 5000ms into a 10s clip → 50%.
    expect(playbackProgress(6000, 0, clip)).toEqual({ position: 5000, pct: 50 });
  });

  it("applies the client→server clock offset", () => {
    // now=6000, offset=-1000 → serverNow 5000 → 4000ms in → 40%.
    expect(playbackProgress(6000, -1000, clip)).toEqual({ position: 4000, pct: 40 });
  });

  it("clamps to the start before the clip begins", () => {
    expect(playbackProgress(500, 0, clip)).toEqual({ position: 0, pct: 0 });
  });

  it("clamps to the end after the clip finishes", () => {
    expect(playbackProgress(999999, 0, clip)).toEqual({ position: 10000, pct: 100 });
  });

  it("avoids dividing by zero for a zero-duration clip", () => {
    expect(playbackProgress(6000, 0, { startedAt: 1000, durationMs: 0 })).toEqual({
      position: 0,
      pct: 0,
    });
  });
});
