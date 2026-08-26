import { describe, expect, it } from "vitest";
import {
  isSpent,
  makeStars,
  spawnAsteroid,
  starBrightness,
  stepAsteroid,
} from "../../src/visual/starfield";

/** Deterministic stand-in for Math.random, so field layout is reproducible. */
function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

describe("makeStars", () => {
  it("scatters the requested number inside the field", () => {
    const stars = makeStars(50, 800, 600, seeded(1));
    expect(stars).toHaveLength(50);
    for (const s of stars) {
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThan(800);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThan(600);
    }
  });

  it("gives every star its own phase so the field does not blink in unison", () => {
    // Shared phase is the classic tell of a fake starfield: the whole sky
    // pulses at once instead of shimmering.
    const phases = new Set(makeStars(40, 800, 600, seeded(2)).map((s) => s.phase));
    expect(phases.size).toBeGreaterThan(30);
  });

  it("mixes filled and outlined stars", () => {
    // All-filled reads as one stamp repeated; all-outlined disappears at small
    // sizes. The field wants both.
    const stars = makeStars(120, 800, 600, seeded(4));
    const outlined = stars.filter((s) => s.outlined).length;
    expect(outlined).toBeGreaterThan(5);
    expect(outlined).toBeLessThan(stars.length - 5);
  });

  it("varies star size, so the sky is not a grid", () => {
    const sizes = new Set(makeStars(120, 800, 600, seeded(5)).map((s) => s.size));
    expect(sizes.size).toBeGreaterThan(1);
  });

  it("is reproducible for a given seed", () => {
    expect(makeStars(10, 400, 400, seeded(7))).toEqual(makeStars(10, 400, 400, seeded(7)));
  });
});

describe("starBrightness", () => {
  const star = { x: 0, y: 0, size: 1, phase: 0, rate: 0.001, outlined: false };

  it("stays within range at every moment", () => {
    for (let t = 0; t < 20000; t += 137) {
      const b = starBrightness(star, t);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(1);
    }
  });

  it("actually varies over time", () => {
    const samples = [0, 500, 1000, 1500, 2000].map((t) => starBrightness(star, t));
    expect(new Set(samples.map((n) => n.toFixed(3))).size).toBeGreaterThan(1);
  });

  it("two stars with different phases differ at the same instant", () => {
    const a = starBrightness({ ...star, phase: 0 }, 1000);
    const b = starBrightness({ ...star, phase: Math.PI }, 1000);
    expect(a).not.toBeCloseTo(b, 2);
  });
});

describe("asteroids", () => {
  it("enters from outside the field so it never pops into view", () => {
    // Spawning inside the viewport makes a streak appear from nothing in the
    // middle of the sky, which reads as a glitch rather than a meteor.
    const a = spawnAsteroid(800, 600, seeded(3));
    const outside = a.x < 0 || a.x > 800 || a.y < 0 || a.y > 600;
    expect(outside).toBe(true);
  });

  it("travels", () => {
    const a = spawnAsteroid(800, 600, seeded(4));
    const moved = stepAsteroid(a, 200);
    expect(moved.x !== a.x || moved.y !== a.y).toBe(true);
  });

  it("moves further over a longer step, so speed is time-based not frame-based", () => {
    // Frame-based motion runs at different speeds on different refresh rates.
    const a = spawnAsteroid(800, 600, seeded(5));
    const short = stepAsteroid(a, 16);
    const long = stepAsteroid(a, 160);
    expect(Math.hypot(long.x - a.x, long.y - a.y)).toBeGreaterThan(
      Math.hypot(short.x - a.x, short.y - a.y),
    );
  });

  it("is spent once it has crossed well past the far edge", () => {
    const a = { ...spawnAsteroid(800, 600, seeded(6)), x: 5000, y: 5000 };
    expect(isSpent(a, 800, 600)).toBe(true);
  });

  it("is not spent while still on its way in", () => {
    const a = spawnAsteroid(800, 600, seeded(8));
    expect(isSpent(a, 800, 600)).toBe(false);
  });
});
