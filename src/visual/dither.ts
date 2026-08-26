/**
 * Ordered (Bayer) dithering — the black-and-white lattice behind june.
 *
 * Deliberately an *ordered* screen rather than error diffusion. Floyd–Steinberg
 * and friends push their error to neighbouring pixels, which yields organic,
 * irregular clusters; an ordered screen thresholds every pixel against a fixed
 * tiled matrix, so the result is a regular crosshatch lattice. That lattice is
 * the entire look — see the design spec for the four strategies compared.
 *
 * No DOM in here on purpose: this is pixel maths, and it is easier to trust
 * when it can be tested over known inputs.
 */

/** Rec. 601 luma weights — how bright a colour actually looks, not its mean. */
const R = 0.299;
const G = 0.587;
const B = 0.114;

/**
 * A Bayer threshold matrix of side `n` (a power of two).
 *
 * Built recursively: each quadrant is the previous matrix scaled by four and
 * offset by 0, 2, 3, 1 — clockwise from the top left, *not* in reading order.
 * Getting that offset order wrong still produces a plausible-looking lattice,
 * which is why the shape is pinned by test rather than eyeballed.
 */
export function bayerMatrix(n: number): number[][] {
  if (n === 1) return [[0]];
  const half = n / 2;
  const smaller = bayerMatrix(half);
  const offsets = [0, 2, 3, 1];
  const out: number[][] = [];
  for (let y = 0; y < n; y++) {
    out[y] = [];
    for (let x = 0; x < n; x++) {
      const quadrant = (y < half ? 0 : 2) + (x < half ? 0 : 1);
      out[y]![x] = smaller[y % half]![x % half]! * 4 + offsets[quadrant]!;
    }
  }
  return out;
}

/** Perceived brightness per pixel, 0..1, from packed RGBA. */
export function luminance(rgba: Uint8ClampedArray): Float32Array {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) {
    out[i] = (rgba[i * 4]! * R + rgba[i * 4 + 1]! * G + rgba[i * 4 + 2]! * B) / 255;
  }
  return out;
}

/**
 * Stretch to the full 0..1 range, then apply `gamma`, in place.
 *
 * An ordered screen thresholds against fixed values, so the input's tonal
 * placement decides everything: an image that only occupies the top third of
 * the range comes out almost entirely white. Gamma below 1 then lifts the mass
 * toward the midtones, which is the only region where the lattice has texture
 * to give — at the extremes it is simply solid.
 *
 * A flat source has no range to stretch. Guarded rather than divided, because
 * the alternative is a field of NaN that renders as a blank canvas: a silent
 * failure that looks like a styling bug.
 */
export function autoLevels(gray: Float32Array, gamma = 0.85): void {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of gray) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const range = hi - lo;
  if (!(range > 1e-6)) return;
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.pow((gray[i]! - lo) / range, gamma);
  }
}

/**
 * Threshold 0..1 luminance into 0 or 255, in place, against a tiled matrix.
 *
 * Because the matrix tiles rather than tracking per-pixel error, the output
 * repeats on the matrix period — that repetition is the lattice, and it is
 * what an error-diffusion dither cannot produce.
 */
export function ditherOrdered(
  gray: Float32Array,
  width: number,
  height: number,
  matrix: number[][],
): void {
  const size = matrix.length;
  const levels = size * size;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const threshold = (matrix[y % size]![x % size]! + 0.5) / levels;
      const i = y * width + x;
      gray[i] = gray[i]! > threshold ? 255 : 0;
    }
  }
}
