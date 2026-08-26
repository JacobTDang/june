import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CORNER_TO_CORNER_PERCENT,
  REVEAL_STOPS,
  coveredFraction,
  stopPercent,
} from "../../src/lib/reveal";

/** Viewports to hold the reveal to. The square is deliberate: it is the worst
 *  case for a corner-anchored circle and nobody browses in one, so it is the
 *  ceiling rather than the target. */
const VIEWPORTS: Array<[number, number, string]> = [
  [1870, 1000, "wide laptop"],
  [1440, 900, "16:10"],
  [1280, 720, "16:9"],
  [1512, 982, "14-inch"],
  [390, 844, "phone portrait"],
  [1000, 1000, "square"],
];

describe("coveredFraction", () => {
  it("covers nothing at zero radius", () => {
    expect(coveredFraction(0, 1440, 900)).toBe(0);
    expect(coveredFraction(-5, 1440, 900)).toBe(0);
  });

  it("covers everything once it reaches the far corner", () => {
    expect(coveredFraction(Math.hypot(1440, 900), 1440, 900)).toBeCloseTo(1, 2);
  });

  it("grows as the square of the radius while the circle is still inside", () => {
    // A quarter disc: doubling r quadruples the area. This is the whole reason
    // a linear radius reads as an accelerating wipe.
    const a = coveredFraction(100, 1440, 900);
    const b = coveredFraction(200, 1440, 900);
    expect(b / a).toBeCloseTo(4, 1);
  });

  it("never decreases as the radius grows", () => {
    let prev = 0;
    for (let r = 0; r <= 1800; r += 60) {
      const now = coveredFraction(r, 1440, 900);
      expect(now).toBeGreaterThanOrEqual(prev);
      prev = now;
    }
  });
});

describe("REVEAL_STOPS", () => {
  it("ends at the full radius and rises the whole way", () => {
    expect(REVEAL_STOPS[REVEAL_STOPS.length - 1]).toBe(1);
    for (let i = 1; i < REVEAL_STOPS.length; i++) {
      expect(REVEAL_STOPS[i]!).toBeGreaterThan(REVEAL_STOPS[i - 1]!);
    }
  });

  it("keeps the screen filling at a near-even rate on real viewports", () => {
    // The point of the schedule. A linear radius measures 7-13x here, which is
    // what made the reveal crawl and then flood past the halfway point.
    for (const [w, h, label] of VIEWPORTS) {
      const R = Math.hypot(w, h);
      const coverage = [0, ...REVEAL_STOPS.map((f) => coveredFraction(f * R, w, h))];
      const steps = coverage.slice(1).map((c, i) => c - coverage[i]!);
      const evenness = Math.max(...steps) / Math.min(...steps);
      expect(evenness, `${label} ${w}x${h}`).toBeLessThan(2.3);
    }
  });

  it("is much more even than animating the radius linearly", () => {
    const [w, h] = [1440, 900];
    const R = Math.hypot(w, h);
    const spread = (radii: number[]) => {
      const cov = [0, ...radii.map((r) => coveredFraction(r, w, h))];
      const steps = cov.slice(1).map((c, i) => c - cov[i]!);
      return Math.max(...steps) / Math.min(...steps);
    };
    const scheduled = spread(REVEAL_STOPS.map((f) => f * R));
    const linear = spread(REVEAL_STOPS.map((_, i) => ((i + 1) / REVEAL_STOPS.length) * R));
    expect(scheduled).toBeLessThan(linear / 4);
  });
});

describe("CORNER_TO_CORNER_PERCENT", () => {
  it("is the diagonal of the box circle() is clipping", () => {
    // circle() resolves a percentage radius as sqrt(w^2+h^2)/sqrt(2), so
    // sqrt(2)*100% reaches corner to corner whatever the box turns out to be.
    // At least that, never less - a rounding error short is a visible sliver.
    expect(CORNER_TO_CORNER_PERCENT / 100).toBeGreaterThanOrEqual(Math.SQRT2);
    expect(CORNER_TO_CORNER_PERCENT / 100).toBeLessThan(Math.SQRT2 * 1.002);
  });

  it("covers the whole viewport from a corner, on any shape", () => {
    for (const [w, h, label] of VIEWPORTS) {
      // what the browser resolves the final radius to
      const r = (CORNER_TO_CORNER_PERCENT / 100) * (Math.hypot(w, h) / Math.SQRT2);
      expect(coveredFraction(r, w, h), `${label} ${w}x${h}`).toBeCloseTo(1, 3);
    }
  });
});

describe("the stylesheet", () => {
  it("animates the exact stops this module derives", () => {
    // The schedule is baked into CSS so the reveal needs no JS maths, which
    // means the two can drift apart silently. They must not.
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    const block = /@keyframes theme-reveal \{([\s\S]*?)\n\}/.exec(css);
    expect(block, "theme-reveal keyframes missing").not.toBeNull();
    const found = [...block![1]!.matchAll(/circle\(([0-9.]+)% at/g)].map((m) => Number(m[1]));
    expect(found).toEqual([0, ...REVEAL_STOPS.map(stopPercent)]);
  });

  it("holds the clip outside the animation's active phase", () => {
    // Without a fill mode the clip is `none` before and after, which paints
    // the incoming theme unclipped - a full-screen flash at the start, and the
    // final sliver popping in at the end.
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    const rule = /::view-transition-new\(root\) \{([\s\S]*?)\n\}/.exec(css);
    expect(rule, "::view-transition-new(root) rule missing").not.toBeNull();
    expect(rule![1]).toMatch(/animation:[^;]*\bboth\b/);
  });

  it("never measures the window for the radius", () => {
    // A radius from innerWidth/innerHeight is measured against a different box
    // than the one clip-path resolves against; a few pixels short leaves the
    // far corner uncovered.
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).not.toContain("--reveal-r");
  });
});
