import { describe, expect, it } from "vitest";
import { NUDGE_STEP_MS, clampNudge, nudgeKey, readNudge } from "../../src/lyrics/nudge";

describe("readNudge", () => {
  it("is zero when nothing is stored", () => {
    expect(readNudge(null)).toBe(0);
  });

  it("keeps a stored nudge", () => {
    expect(readNudge("500")).toBe(500);
    expect(readNudge("-750")).toBe(-750);
  });

  it("ignores junk rather than shifting the lyrics somewhere strange", () => {
    expect(readNudge("later")).toBe(0);
    expect(readNudge("")).toBe(0);
  });

  it("clamps a stored value that's beyond the allowed range", () => {
    expect(readNudge("999999")).toBe(clampNudge(999_999));
    expect(readNudge("-999999")).toBe(clampNudge(-999_999));
  });
});

describe("clampNudge", () => {
  it("allows a few seconds either way", () => {
    expect(clampNudge(NUDGE_STEP_MS)).toBe(NUDGE_STEP_MS);
    expect(clampNudge(-NUDGE_STEP_MS)).toBe(-NUDGE_STEP_MS);
  });

  it("stops well short of nonsense", () => {
    // Past a few seconds the file is simply the wrong recording, and nudging
    // is the wrong cure.
    expect(clampNudge(60_000)).toBeLessThanOrEqual(10_000);
    expect(clampNudge(-60_000)).toBeGreaterThanOrEqual(-10_000);
  });
});

describe("nudgeKey", () => {
  it("is per track, so a fix for one song doesn't shift another", () => {
    expect(nudgeKey("abc")).not.toBe(nudgeKey("xyz"));
    expect(nudgeKey("abc")).toContain("abc");
  });
});
