import { describe, expect, it } from "vitest";
import {
  STORAGE_KEY,
  coverRadius,
  nextChoice,
  readChoice,
  resolveTheme,
} from "../../src/lib/theme";

describe("resolveTheme", () => {
  it("follows the system when nothing has been chosen", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("lets an explicit choice win over the system", () => {
    // Someone who picked light on a dark-mode laptop meant it.
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("readChoice", () => {
  it("reads the two explicit choices back", () => {
    expect(readChoice("light")).toBe("light");
    expect(readChoice("dark")).toBe("dark");
  });

  it("falls back to system for anything unrecognised", () => {
    // localStorage is shared, user-writable, and survives deploys - a stale or
    // hand-edited value must not leave the page with no theme at all.
    expect(readChoice(null)).toBe("system");
    expect(readChoice("")).toBe("system");
    expect(readChoice("solarized")).toBe("system");
    expect(readChoice("DARK")).toBe("system");
  });

  it("accepts an explicit system choice", () => {
    expect(readChoice("system")).toBe("system");
  });
});

describe("nextChoice", () => {
  it("flips to the opposite of what is on screen", () => {
    expect(nextChoice("light")).toBe("dark");
    expect(nextChoice("dark")).toBe("light");
  });
});

describe("STORAGE_KEY", () => {
  it("is namespaced so it cannot collide with another june key", () => {
    expect(STORAGE_KEY).toBe("june:theme");
  });
});

describe("coverRadius", () => {
  it("reaches the far corner from the middle", () => {
    // 100x100 from dead centre: half-diagonal is sqrt(50^2 + 50^2).
    expect(coverRadius(50, 50, 100, 100)).toBeCloseTo(Math.SQRT2 * 50, 6);
  });

  it("reaches the opposite corner from a corner", () => {
    expect(coverRadius(0, 0, 300, 400)).toBeCloseTo(500, 6);
    expect(coverRadius(300, 400, 300, 400)).toBeCloseTo(500, 6);
  });

  it("takes the farthest corner, not the nearest", () => {
    // The toggle sits top-right, so the circle has to grow all the way to the
    // bottom-left or it stops with a wedge of the old theme still showing.
    expect(coverRadius(390, 10, 400, 800)).toBeCloseTo(Math.hypot(390, 790), 6);
  });

  it("still covers when the origin is outside the viewport", () => {
    // A toggle scrolled off-screen reports a negative coordinate.
    expect(coverRadius(-20, -20, 100, 100)).toBeCloseTo(Math.hypot(120, 120), 6);
  });
});
