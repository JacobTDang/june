import { describe, expect, it } from "vitest";
import { readVolume, volumeLevel } from "../../src/lib/room/volume";

describe("readVolume", () => {
  it("defaults to full volume when nothing is stored", () => {
    expect(readVolume(null)).toBe(1);
  });

  it("keeps a stored level", () => {
    expect(readVolume("0.5")).toBe(0.5);
    expect(readVolume("0")).toBe(0);
  });

  it("clamps a level from outside the range", () => {
    expect(readVolume("-0.5")).toBe(0);
    expect(readVolume("4")).toBe(1);
  });

  it("falls back to full volume on a value it can't read", () => {
    // Storage is user-writable and outlives releases; garbage must not leave
    // a device silent with no explanation.
    expect(readVolume("loud")).toBe(1);
    expect(readVolume("")).toBe(1);
    expect(readVolume("NaN")).toBe(1);
  });
});

describe("volumeLevel", () => {
  it("names the level so the icon can follow it", () => {
    expect(volumeLevel(0)).toBe("off");
    expect(volumeLevel(0.3)).toBe("low");
    expect(volumeLevel(0.9)).toBe("high");
  });

  it("treats a level rounding to nothing as off", () => {
    expect(volumeLevel(0.004)).toBe("off");
  });
});
