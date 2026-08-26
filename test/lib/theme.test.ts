import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  STORAGE_KEY,
  coverRadius,
  nextTheme,
  readTheme,
} from "../../src/lib/theme";

describe("DEFAULT_THEME", () => {
  it("is dark, which is what june looks like out of the box", () => {
    expect(DEFAULT_THEME).toBe("dark");
  });
});

describe("readTheme", () => {
  it("reads an explicit choice back", () => {
    expect(readTheme("light")).toBe("light");
    expect(readTheme("dark")).toBe("dark");
  });

  it("defaults to dark when nothing has been chosen", () => {
    expect(readTheme(null)).toBe("dark");
  });

  it("falls back to the default for anything unrecognised", () => {
    // localStorage is shared, user-writable, and survives deploys - a stale or
    // hand-edited value must not leave the page with no theme at all.
    expect(readTheme("")).toBe("dark");
    expect(readTheme("solarized")).toBe("dark");
    expect(readTheme("LIGHT")).toBe("dark");
    // "system" was a choice in an earlier cut; anyone still holding it gets
    // the default rather than an unhandled state.
    expect(readTheme("system")).toBe("dark");
  });
});

describe("nextTheme", () => {
  it("flips to the opposite of what is on screen", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
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
