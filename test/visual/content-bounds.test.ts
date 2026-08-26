import { describe, expect, it } from "vitest";
import { contentBounds } from "../../src/visual/content-bounds";

/** Build packed RGBA from a per-pixel colour function. */
function image(
  w: number,
  h: number,
  at: (x: number, y: number) => [number, number, number],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = at(x, y);
      const i = (y * w + x) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }
  return out;
}

/** Deterministic per-pixel hash, 0..1 — stands in for a real photograph's
 *  detail. Sharp on purpose: what separates artwork from a bar is that
 *  neighbouring pixels disagree. */
function grain(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/** A photograph: full-range, high-frequency, never flat. */
function photo(x: number, y: number): [number, number, number] {
  const v = Math.round(grain(x, y) * 255);
  return [v, Math.round(grain(x + 7, y) * 255), Math.round(grain(x, y + 11) * 255)];
}

describe("contentBounds", () => {
  it("returns the whole frame for a full-bleed picture", () => {
    // The common case, and the one that must be exact: no bars, nothing
    // trimmed, so the band spans the sleeve edge to edge as it does today.
    const w = 120;
    const h = 90;
    expect(contentBounds(image(w, h, photo), w, h)).toEqual({
      left: 0,
      top: 0,
      right: w,
      bottom: h,
    });
  });

  it("finds a square cover inside black pillarbox bars", () => {
    // 16:9 YouTube thumbnail, square sleeve centred, flat black either side.
    const w = 160;
    const h = 90;
    const inner = { left: 35, right: 125 };
    const data = image(w, h, (x, y) =>
      x >= inner.left && x < inner.right ? photo(x, y) : [0, 0, 0],
    );
    expect(contentBounds(data, w, h)).toEqual({
      left: inner.left,
      top: 0,
      right: inner.right,
      bottom: h,
    });
  });

  it("finds the same cover inside white bars", () => {
    // Bars are not always black — a white card is just as common.
    const w = 160;
    const h = 90;
    const data = image(w, h, (x, y) => (x >= 35 && x < 125 ? photo(x, y) : [255, 255, 255]));
    expect(contentBounds(data, w, h)).toEqual({ left: 35, top: 0, right: 125, bottom: h });
  });

  it("finds the cover inside mid-grey bars", () => {
    const w = 160;
    const h = 90;
    const data = image(w, h, (x, y) => (x >= 35 && x < 125 ? photo(x, y) : [128, 128, 128]));
    expect(contentBounds(data, w, h)).toEqual({ left: 35, top: 0, right: 125, bottom: h });
  });

  it("finds a cover inside a blurred smear of itself", () => {
    // The other common bar: the sleeve blown up and blurred behind itself.
    // It is not uniform — it drifts across the bar — but it has no edges,
    // so an exact-uniformity test misses it entirely.
    const w = 160;
    const h = 90;
    const smear = (x: number, y: number): [number, number, number] => {
      const v = 60 + Math.round((x / w) * 30 + (y / h) * 25);
      return [v, v + 4, v - 3];
    };
    const data = image(w, h, (x, y) => (x >= 35 && x < 125 ? photo(x, y) : smear(x, y)));
    expect(contentBounds(data, w, h)).toEqual({ left: 35, top: 0, right: 125, bottom: h });
  });

  it("finds an off-centre letterbox and reports it asymmetric", () => {
    // Bottom-anchored cover fitting means the bars are rarely equal, so the
    // box has to be reported as it is rather than as a symmetric inset.
    const w = 100;
    const h = 120;
    const data = image(w, h, (x, y) => (y >= 10 && y < 90 ? photo(x, y) : [0, 0, 0]));
    expect(contentBounds(data, w, h)).toEqual({ left: 0, top: 10, right: w, bottom: 90 });
  });

  it("finds a window inside bars on all four edges", () => {
    const w = 120;
    const h = 120;
    const data = image(w, h, (x, y) =>
      x >= 20 && x < 100 && y >= 14 && y < 96 ? photo(x, y) : [12, 12, 12],
    );
    expect(contentBounds(data, w, h)).toEqual({ left: 20, top: 14, right: 100, bottom: 96 });
  });

  it("leaves a dark, low-contrast photograph alone", () => {
    // The failure that would be worst: eating a moody sleeve because it is
    // dim. Dim is not flat — these pixels still disagree with their
    // neighbours, and that is the test.
    const w = 120;
    const h = 90;
    const dim = (x: number, y: number): [number, number, number] => {
      const v = 8 + Math.round(grain(x, y) * 34);
      return [v, v + 2, v + 5];
    };
    expect(contentBounds(image(w, h, dim), w, h)).toEqual({
      left: 0,
      top: 0,
      right: w,
      bottom: h,
    });
  });

  it("never trims more than 30% in from any edge", () => {
    // A frame that is flat all the way through has no content box at all.
    // Rather than collapse to nothing, it stops at the cap and hands back a
    // box the band can still be drawn in.
    const w = 100;
    const h = 100;
    const box = contentBounds(image(w, h, () => [0, 0, 0]), w, h);
    expect(box.left).toBeLessThanOrEqual(30);
    expect(box.top).toBeLessThanOrEqual(30);
    expect(box.right).toBeGreaterThanOrEqual(70);
    expect(box.bottom).toBeGreaterThanOrEqual(70);
    expect(box.right - box.left).toBeGreaterThan(0);
    expect(box.bottom - box.top).toBeGreaterThan(0);
  });

  it("stops at the cap rather than swallowing a wide bar", () => {
    // Bars wider than the cap are possible in principle; the cap wins, on
    // the grounds that trimming half a sleeve away is a worse mistake than
    // leaving a strip of bar in the band.
    const w = 100;
    const h = 40;
    const data = image(w, h, (x, y) => (x >= 45 && x < 55 ? photo(x, y) : [0, 0, 0]));
    const box = contentBounds(data, w, h);
    expect(box.left).toBe(30);
    expect(box.right).toBe(70);
  });

  it("does not modify the pixels it is given", () => {
    const w = 40;
    const h = 30;
    const data = image(w, h, (x, y) => (x >= 10 && x < 30 ? photo(x, y) : [0, 0, 0]));
    const before = Uint8ClampedArray.from(data);
    contentBounds(data, w, h);
    expect(data).toEqual(before);
  });

  it("survives degenerate sizes", () => {
    expect(contentBounds(new Uint8ClampedArray(4), 1, 1)).toEqual({
      left: 0,
      top: 0,
      right: 1,
      bottom: 1,
    });
    expect(contentBounds(new Uint8ClampedArray(0), 0, 0)).toEqual({
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    });
  });

  it("ignores fully transparent padding the same way it ignores a flat bar", () => {
    // A canvas is transparent before anything is drawn on it. Untouched
    // pixels are flat by definition, so they trim like any other bar.
    const w = 100;
    const h = 40;
    const data = image(w, h, (x, y) => (x >= 25 && x < 75 ? photo(x, y) : [0, 0, 0]));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < 25; x++) data[(y * w + x) * 4 + 3] = 0;
    }
    expect(contentBounds(data, w, h)).toEqual({ left: 25, top: 0, right: 75, bottom: h });
  });
});
