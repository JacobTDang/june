import { describe, expect, it } from "vitest";
import { MAX_COLUMNS, MAX_DOTS, computeGrid } from "../../src/audio/grid";

type Box = [width: number, height: number];

/** How far a cell may drift from square before the field reads as stretched. */
function cellAspect(width: number, height: number): number {
  const { cols, rows } = computeGrid(width, height);
  return width / cols / (height / rows);
}

describe("computeGrid", () => {
  it("follows the box's shape: wide boxes get more columns, tall boxes more rows", () => {
    const wide = computeGrid(900, 300);
    expect(wide.cols).toBeGreaterThan(wide.rows);

    const tall = computeGrid(400, 900);
    expect(tall.rows).toBeGreaterThan(tall.cols);
  });

  it("keeps cells near-square across shapes", () => {
    // The regression this guards: a fixed row cap left a tall card with cells
    // twice as tall as they were wide, so the dots read as a stretched field
    // rather than a constellation.
    const boxes: Box[] = [
      [480, 740],
      [400, 900],
      [900, 300],
      [700, 700],
      [1200, 800],
    ];
    for (const [w, h] of boxes) {
      const aspect = cellAspect(w, h);
      expect(aspect).toBeGreaterThan(0.8);
      expect(aspect).toBeLessThan(1.25);
    }
  });

  it("stays within the per-frame dot budget", () => {
    const boxes: Box[] = [
      [2400, 1400],
      [1200, 900],
      [480, 740],
    ];
    for (const [w, h] of boxes) {
      const { cols, rows } = computeGrid(w, h);
      expect(cols * rows).toBeLessThanOrEqual(MAX_DOTS);
    }
  });

  it("never asks for more columns than the spectrum can supply", () => {
    expect(computeGrid(4000, 200).cols).toBeLessThanOrEqual(MAX_COLUMNS);
  });

  it("still produces a usable grid for a tiny or zero-sized box", () => {
    const boxes: Box[] = [
      [0, 0],
      [20, 10],
    ];
    for (const [w, h] of boxes) {
      const { cols, rows } = computeGrid(w, h);
      expect(cols).toBeGreaterThanOrEqual(1);
      expect(rows).toBeGreaterThanOrEqual(1);
    }
  });
});
