import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REVEAL_STOPS, coveredFraction } from "../../src/lib/reveal";

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

describe("the stylesheet", () => {
  it("animates the exact stops this module derives", () => {
    // The schedule is baked into CSS so the reveal needs no JS maths, which
    // means the two can drift apart silently. They must not.
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    const block = /@keyframes theme-reveal \{([\s\S]*?)\n\}/.exec(css);
    expect(block, "theme-reveal keyframes missing").not.toBeNull();
    const found = [...block![1]!.matchAll(/calc\(var\(--reveal-r\) \* ([0-9.]+)\)/g)].map((m) =>
      Number(m[1]),
    );
    // every stop but the last, which is plain var(--reveal-r)
    expect(found).toEqual(REVEAL_STOPS.slice(0, -1));
    expect(block![1]).toContain("clip-path: circle(var(--reveal-r)");
  });
});
