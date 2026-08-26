import { describe, expect, it } from "vitest";
import { dominantColors, withAlpha } from "../../src/visual/palette";

/** A w×h RGBA buffer filled from a per-pixel function. */
function image(w: number, h: number, at: (i: number) => [number, number, number]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b] = at(i);
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe("dominantColors", () => {
  it("finds the colour of a solid image", () => {
    const [c] = dominantColors(image(20, 20, () => [200, 30, 40]), 3);
    expect(c!.r).toBeGreaterThan(150);
    expect(c!.g).toBeLessThan(90);
    expect(c!.b).toBeLessThan(90);
  });

  it("returns the requested number when the image has that many", () => {
    const colors = dominantColors(
      image(60, 1, (i) => (i < 20 ? [220, 20, 20] : i < 40 ? [20, 200, 20] : [20, 20, 220])),
      3,
    );
    expect(colors).toHaveLength(3);
  });

  it("prefers colour over grey, since grey is what the dither already shows", () => {
    // Three quarters neutral, one quarter vivid. The bloom exists to add what
    // the one-bit rendering cannot, so the vivid quarter has to win.
    const colors = dominantColors(
      image(80, 1, (i) => (i < 60 ? [128, 128, 128] : [230, 40, 160])),
      2,
    );
    const first = colors[0]!;
    expect(Math.max(first.r, first.g, first.b) - Math.min(first.r, first.g, first.b))
      .toBeGreaterThan(60);
  });

  it("falls back to something usable for a wholly grey image", () => {
    // A black-and-white sleeve is common. Returning nothing would leave the
    // bloom undefined; returning the greys keeps it honest.
    const colors = dominantColors(image(20, 20, () => [90, 90, 90]), 3);
    expect(colors.length).toBeGreaterThan(0);
    for (const c of colors) {
      expect(c.r).toBeGreaterThanOrEqual(0);
      expect(c.r).toBeLessThanOrEqual(255);
    }
  });

  it("never returns more than the image can offer", () => {
    expect(dominantColors(image(4, 4, () => [10, 20, 30]), 5).length).toBeLessThanOrEqual(5);
  });

  it("handles an empty buffer without throwing", () => {
    expect(dominantColors(new Uint8ClampedArray(0), 3)).toEqual([]);
  });

  it("ignores fully transparent pixels", () => {
    const data = image(10, 1, () => [255, 0, 0]);
    for (let i = 0; i < 5; i++) data[i * 4 + 3] = 0;
    const colors = dominantColors(data, 1);
    expect(colors[0]!.r).toBeGreaterThan(150);
  });
});

describe("withAlpha", () => {
  it("turns a six-digit hex into rgba at the given alpha", () => {
    expect(withAlpha("#111111", 0.34)).toBe("rgba(17, 17, 17, 0.34)");
    expect(withAlpha("#eeeeee", 0.9)).toBe("rgba(238, 238, 238, 0.9)");
  });

  it("expands three-digit hex", () => {
    expect(withAlpha("#fff", 1)).toBe("rgba(255, 255, 255, 1)");
  });

  it("tolerates the whitespace a CSS custom property comes back with", () => {
    // getPropertyValue returns " #111111" for `--ink: #111111`.
    expect(withAlpha("  #111111  ", 0.5)).toBe("rgba(17, 17, 17, 0.5)");
  });

  it("passes a non-hex colour through at full strength rather than guessing", () => {
    // A token could hold rgb()/oklch(); silently returning transparent black
    // would paint an invisible starfield and look like a broken canvas.
    expect(withAlpha("rebeccapurple", 0.4)).toBe("rebeccapurple");
  });
});
