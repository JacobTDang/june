import { describe, expect, it } from "vitest";
import {
  isSpent,
  makeStars,
  makeStaves,
  sparkleShape,
  STAVE_EDGE_BAND,
  spawnAsteroid,
  starBrightness,
  starHand,
  stepAsteroid,
  wobbleAt,
  type SparkleShape,
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

  it("gives every star its own seed, so no two are drawn by the same hand", () => {
    // The seed is what makes one star's wobble its own. Shared seeds would put
    // the same lopsided sparkle all over the sky.
    const seeds = new Set(makeStars(40, 800, 600, seeded(9)).map((s) => s.seed));
    expect(seeds.size).toBeGreaterThan(30);
  });

  it("is reproducible for a given seed", () => {
    expect(makeStars(10, 400, 400, seeded(7))).toEqual(makeStars(10, 400, 400, seeded(7)));
  });
});

describe("starBrightness", () => {
  const star = { x: 0, y: 0, size: 1, phase: 0, rate: 0.001, outlined: false, seed: 0 };

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

  it("places nearly all of them at the sparse count the background asks for", () => {
    // The background deliberately asks for a thin field, and that number was
    // tuned on the count actually drawn rather than the count requested. At
    // this spacing almost every fragment finds room, so the ceiling sits close
    // to a quota — if placement ever tightens, the field silently thins out
    // and this is what catches it.
    expect(makeStaves(36, 1440, 900, seeded(27)).length).toBeGreaterThanOrEqual(34);
    expect(makeStaves(13, 390, 844, seeded(28)).length).toBeGreaterThanOrEqual(12);
  });
});

describe("wobbleAt", () => {
  it("draws the same wobble every time, so nothing shivers between repaints", () => {
    // The whole point of a seeded pen: the field is repainted every frame, and
    // a wobble that were random per call would make the sky vibrate.
    expect(wobbleAt(3.5, 0.4)).toBe(wobbleAt(3.5, 0.4));
  });

  it("stays within the pen's reach", () => {
    for (let seed = 0; seed < 40; seed++) {
      for (let t = 0; t <= 1.0001; t += 0.05) {
        expect(Math.abs(wobbleAt(seed, t))).toBeLessThanOrEqual(1);
      }
    }
  });

  it("gives two seeds two different hands", () => {
    expect(wobbleAt(1, 0.5)).not.toBeCloseTo(wobbleAt(9, 0.5), 3);
  });

  it("drifts along a stroke rather than jittering", () => {
    // Random jitter per point looks like a bad signal; drift looks like a
    // wrist. Neighbouring points must stay close together.
    for (let t = 0; t < 1; t += 0.01) {
      expect(Math.abs(wobbleAt(6.25, t + 0.01) - wobbleAt(6.25, t))).toBeLessThan(0.2);
    }
  });
});

/** Every coordinate of an outline in draw order — what actually reaches the
 *  canvas, as a flat list so two outlines can be compared point for point. */
function flat(shape: SparkleShape): number[] {
  return shape.sides.flatMap((side) => [side.waist.x, side.waist.y, side.tip.x, side.tip.y]);
}

/** The outline with the radius divided out. What is left is the shape alone,
 *  so any difference cannot be explained away as the star being bigger. */
function outline(seed: number, radius: number, drift: number): number[] {
  return flat(sparkleShape(seed, radius, drift)).map((n) => n / radius);
}

/** How far the furthest point of one outline has moved from the matching point
 *  of another. */
function maxMove(a: number[], b: number[]): number {
  let worst = 0;
  for (let i = 0; i < a.length; i += 2) {
    worst = Math.max(worst, Math.hypot(a[i]! - b[i]!, a[i + 1]! - b[i + 1]!));
  }
  return worst;
}

describe("sparkleShape", () => {
  it("draws a star the same way every time it is asked for", () => {
    expect(sparkleShape(12.5, 6, 0.3)).toEqual(sparkleShape(12.5, 6, 0.3));
  });

  it("draws two seeds by two different hands", () => {
    expect(flat(sparkleShape(12.5, 6, 0.3))).not.toEqual(flat(sparkleShape(77.25, 6, 0.3)));
  });

  it("closes: the pen ends where it started", () => {
    const shape = sparkleShape(41.7, 6, 0.5);
    expect(shape.sides).toHaveLength(4);
    expect(shape.sides.at(-1)!.tip).toEqual(shape.start);
  });

  it("gives the four arms four different lengths", () => {
    // Four arms of one length is the perfect stamp we are getting away from.
    const reach = sparkleShape(31.4, 6, 0).sides.map((s) => Math.hypot(s.tip.x, s.tip.y));
    expect(new Set(reach.map((n) => n.toFixed(4))).size).toBe(4);
  });

  it("pinches each side at its own point rather than all four at the centre", () => {
    const waists = sparkleShape(58.1, 6, 0.2).sides.map((s) => s.waist);
    for (const w of waists) expect(Math.hypot(w.x, w.y)).toBeGreaterThan(0);
    expect(new Set(waists.map((w) => `${w.x.toFixed(4)},${w.y.toFixed(4)}`)).size).toBe(4);
  });

  it("still reads as a four-point sparkle however the hand wanders", () => {
    // Hand-drawn, not deformed: the arms still reach roughly the same distance
    // and still point roughly north, east, south and west, and the sides are
    // still pulled in toward the middle — a straight-sided version would be a
    // diamond, which reads as a gem rather than a glint.
    for (const seed of [0, 4.2, 19.9, 133.7, 812.4]) {
      for (const drift of [0, 0.7, 3.3]) {
        const { sides } = sparkleShape(seed, 6, drift);
        const seen = new Set<number>();
        for (const { tip, waist } of sides) {
          const reach = Math.hypot(tip.x, tip.y);
          expect(reach).toBeGreaterThan(6 * 0.75);
          expect(reach).toBeLessThan(6 * 1.25);
          const angle = Math.atan2(tip.y, tip.x);
          const quarter = Math.round(angle / (Math.PI / 2));
          const off = Math.abs(angle - quarter * (Math.PI / 2));
          expect(off).toBeLessThan(0.3);
          seen.add(((quarter % 4) + 4) % 4);
          expect(Math.hypot(waist.x, waist.y)).toBeLessThan(6 * 0.4);
        }
        // One arm to each quarter — no two arms collapsing onto each other.
        expect(seen.size).toBe(4);
      }
    }
  });

  it("scales with the radius and cares about nothing else about it", () => {
    // Radius is the twinkle's job. The shape itself must not change character
    // as the star swells, or the star stops being the same star.
    const small = outline(9.5, 3, 0.4);
    const large = outline(9.5, 12, 0.4);
    small.forEach((n, i) => expect(n).toBeCloseTo(large[i]!, 10));
  });
});

describe("the twinkle redraws the star rather than zooming it", () => {
  const star = { x: 0, y: 0, size: 4, phase: 0.4, rate: 0.0012, outlined: false, seed: 61.3 };

  it("puts the drawing hand somewhere different at every moment", () => {
    expect(new Set([0, 900, 1800, 2700].map((t) => starHand(star, t))).size).toBe(4);
  });

  it("starts two stars mid-way through different strokes", () => {
    expect(starHand({ ...star, seed: 3 }, 0)).not.toBeCloseTo(
      starHand({ ...star, seed: 88 }, 0),
      4,
    );
  });

  it("settles to one fixed hand when the field is not animating", () => {
    // Under prefers-reduced-motion the field is painted once and left alone. A
    // still star still has to look drawn — the wobble is shape, not motion.
    expect(sparkleShape(star.seed, 5, starHand(star, 0))).toEqual(
      sparkleShape(star.seed, 5, starHand(star, 0)),
    );
  });

  it("changes the outline itself over time, not only its size", () => {
    // With the radius divided out, anything left over is the star having been
    // drawn again rather than scaled.
    const early = outline(star.seed, 5, starHand(star, 0));
    const later = outline(star.seed, 5, starHand(star, 4000));
    expect(maxMove(early, later)).toBeGreaterThan(0.01);
  });

  it("drifts continuously — it never cuts to a new pose", () => {
    // An earlier attempt flipped the drawing between a couple of fixed frames.
    // It read as a glitch rather than a hand. Nothing may move far in the gap
    // between two frames.
    let worst = 0;
    for (let t = 0; t < 12000; t += 16) {
      worst = Math.max(
        worst,
        maxMove(
          outline(star.seed, 5, starHand(star, t)),
          outline(star.seed, 5, starHand(star, t + 16)),
        ),
      );
    }
    expect(worst).toBeLessThan(0.01);
  });

  it("has drifted far further over seconds than over one frame", () => {
    const base = outline(star.seed, 5, starHand(star, 0));
    const frame = maxMove(base, outline(star.seed, 5, starHand(star, 16)));
    const seconds = maxMove(base, outline(star.seed, 5, starHand(star, 3000)));
    expect(seconds).toBeGreaterThan(frame * 10);
  });

  it("stays slower than the twinkle it rides on", () => {
    // The redrawing is meant to be read as the same star drawn again, not as a
    // second animation competing with the swell.
    const twinkle = Math.abs(star.rate * 1000);
    expect(Math.abs(starHand(star, 1000) - starHand(star, 0))).toBeLessThan(twinkle);
  });
});
