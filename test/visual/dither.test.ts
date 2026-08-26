import { describe, expect, it } from "vitest";
import {
  autoLevels,
  bayerMatrix,
  ditherOrdered,
  luminance,
} from "../../src/visual/dither";

/** A w×h field of one constant value in 0..1. */
function flat(w: number, h: number, v: number): Float32Array {
  return new Float32Array(w * h).fill(v);
}

/** Share of pixels that ended up white. */
function whiteRatio(g: Float32Array): number {
  let white = 0;
  for (const v of g) if (v === 255) white += 1;
  return white / g.length;
}

describe("bayerMatrix", () => {
  it("builds the canonical 2×2", () => {
    expect(bayerMatrix(2)).toEqual([
      [0, 2],
      [3, 1],
    ]);
  });

  it("builds the canonical 4×4 — the chosen screen", () => {
    // The recursive construction is easy to get subtly wrong (the quadrant
    // offsets are 0,2,3,1 — not 0,1,2,3), and a wrong matrix still produces a
    // plausible-looking lattice, so this is pinned to the published values.
    expect(bayerMatrix(4)).toEqual([
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ]);
  });

  it("builds an 8×8 holding every threshold exactly once", () => {
    const m = bayerMatrix(8).flat();
    expect(m).toHaveLength(64);
    expect(new Set(m).size).toBe(64);
    expect(Math.min(...m)).toBe(0);
    expect(Math.max(...m)).toBe(63);
  });
});

describe("luminance", () => {
  it("weights the channels the way the eye does", () => {
    // Rec. 601: green reads far brighter than blue at the same value.
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
    const g = luminance(rgba);
    expect(g[0]).toBeCloseTo(0.299, 3);
    expect(g[1]).toBeCloseTo(0.587, 3);
    expect(g[2]).toBeCloseTo(0.114, 3);
  });
});

describe("autoLevels", () => {
  it("stretches a low-contrast band to the full range", () => {
    const g = new Float32Array([0.4, 0.5, 0.6]);
    autoLevels(g, 1);
    expect(g[0]).toBeCloseTo(0, 5);
    expect(g[2]).toBeCloseTo(1, 5);
  });

  it("leaves a flat field alone rather than dividing by zero", () => {
    // A solid-colour source has no range to stretch. Without a guard this is
    // a division by zero and the whole field becomes NaN, which downstream
    // renders as a blank canvas rather than an obvious error.
    const g = flat(4, 4, 0.5);
    autoLevels(g, 1);
    expect([...g].every((v) => Number.isFinite(v))).toBe(true);
  });

  it("applies gamma toward the midtones", () => {
    // Gamma < 1 lifts: the point of it is to move mass into the midtones,
    // which is the only place an ordered screen has texture to give.
    const g = new Float32Array([0, 0.5, 1]);
    autoLevels(g, 0.5);
    expect(g[1]).toBeGreaterThan(0.5);
    expect(g[0]).toBeCloseTo(0, 5);
    expect(g[2]).toBeCloseTo(1, 5);
  });
});

describe("ditherOrdered", () => {
  const m4 = bayerMatrix(4);

  it("leaves pure black with no dots at all", () => {
    const g = flat(8, 8, 0);
    ditherOrdered(g, 8, 8, m4);
    expect(whiteRatio(g)).toBe(0);
  });

  it("leaves pure white with no dots at all", () => {
    const g = flat(8, 8, 1);
    ditherOrdered(g, 8, 8, m4);
    expect(whiteRatio(g)).toBe(1);
  });

  it("renders mid-grey as an even lattice, not a blob", () => {
    // The whole point of an ordered screen: 50% grey must come back as
    // roughly half the pixels, distributed regularly rather than clumped.
    const g = flat(16, 16, 0.5);
    ditherOrdered(g, 16, 16, m4);
    expect(whiteRatio(g)).toBeGreaterThan(0.4);
    expect(whiteRatio(g)).toBeLessThan(0.6);
  });

  it("repeats on the matrix period, which is what makes it a lattice", () => {
    // Error diffusion would give a different answer per pixel; an ordered
    // screen tiles. This is the property that distinguishes the look.
    const g = flat(8, 8, 0.5);
    ditherOrdered(g, 8, 8, m4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(g[y * 8 + x]).toBe(g[y * 8 + (x + 4)]);
        expect(g[y * 8 + x]).toBe(g[(y + 4) * 8 + x]);
      }
    }
  });

  it("gets darker as the input gets darker", () => {
    const ratios = [0.2, 0.5, 0.8].map((v) => {
      const g = flat(16, 16, v);
      ditherOrdered(g, 16, 16, m4);
      return whiteRatio(g);
    });
    expect(ratios[0]!).toBeLessThan(ratios[1]!);
    expect(ratios[1]!).toBeLessThan(ratios[2]!);
  });

  it("only ever emits pure black or pure white", () => {
    const g = new Float32Array(64).map((_, i) => i / 64);
    ditherOrdered(g, 8, 8, m4);
    expect([...g].every((v) => v === 0 || v === 255)).toBe(true);
  });
});
