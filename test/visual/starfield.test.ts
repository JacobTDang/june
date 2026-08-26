import { describe, expect, it } from "vitest";
import {
  isSpent,
  makeStars,
  makeStaves,
  STAVE_EDGE_BAND,
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

describe("makeStaves", () => {
  it("keeps out of the middle band where the cards sit", () => {
    // Notation behind a card is noise the reader has to see past.
    const width = 1000;
    const staves = makeStaves(40, width, 700, seeded(11));
    for (const s of staves) {
      const inMiddle =
        s.x > width * STAVE_EDGE_BAND && s.x < width * (1 - STAVE_EDGE_BAND);
      expect(inMiddle).toBe(false);
    }
  });

  it("gives every stave notes on it", () => {
    for (const s of makeStaves(20, 1000, 700, seeded(12))) {
      expect(s.notes.length).toBeGreaterThan(2);
      for (const n of s.notes) {
        expect(n.at).toBeGreaterThan(0);
        expect(n.at).toBeLessThan(1);
      }
    }
  });

  it("keeps the tilt slight, so a stave reads as drawn and not as a sticker", () => {
    for (const s of makeStaves(30, 1000, 700, seeded(13))) {
      expect(Math.abs(s.tilt)).toBeLessThan(0.1);
    }
  });

  it("is reproducible for a given seed", () => {
    expect(makeStaves(6, 900, 600, seeded(14))).toEqual(makeStaves(6, 900, 600, seeded(14)));
  });
});

describe("staves do not overlap", () => {
  /** What a drawn stave actually occupies: the five lines, plus stems and
   *  ledger lines reaching above and below them. */
  function box(s: ReturnType<typeof makeStaves>[number]) {
    const reach = s.spacing * 4;
    return { x1: s.x, x2: s.x + s.width, y1: s.y - reach, y2: s.y + reach };
  }
  const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
    a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

  it("never places two staves on top of each other", () => {
    // Two fragments of notation crossing reads as a printing error rather
    // than as texture.
    for (const seed of [21, 22, 23, 24]) {
      const staves = makeStaves(40, 1400, 900, seeded(seed));
      for (let i = 0; i < staves.length; i++) {
        for (let j = i + 1; j < staves.length; j++) {
          expect(overlaps(box(staves[i]!), box(staves[j]!))).toBe(false);
        }
      }
    }
  });

  it("returns fewer than asked rather than forcing an overlap", () => {
    // A small field cannot hold many staves. Dropping the ones that will not
    // fit is right; cramming them in is not.
    const staves = makeStaves(200, 500, 400, seeded(25));
    expect(staves.length).toBeLessThan(200);
    expect(staves.length).toBeGreaterThan(0);
  });

  it("still fills a large field generously", () => {
    expect(makeStaves(40, 2200, 1400, seeded(26)).length).toBeGreaterThan(18);
  });
});
