/**
 * Where the picture actually is inside a frame of pixels.
 *
 * Cover art rarely fills the frame it arrives in. A YouTube thumbnail is 16:9
 * and a sleeve is square, so most covers reach june as a square picture sitting
 * in bars — flat black, flat white, or a blurred blow-up of the sleeve itself.
 * Anything drawn to the frame's edge is therefore drawn past the artwork and
 * onto its packing, which reads as a bug rather than as a decision.
 *
 * This finds the artwork's own edges so that what is drawn on the sleeve can
 * stop where the sleeve does.
 *
 * No DOM in here, same as the dither: it is pixel maths, and pixel maths is
 * only trustworthy when it can be run over known inputs.
 */

/** Half-open, like a slice: `left`/`top` are inside, `right`/`bottom` are the
 *  first pixel outside. So the box is `right - left` wide. */
export type ContentBox = { left: number; top: number; right: number; bottom: number };

/** Rec. 601 luma weights, matching the dither's — how bright a colour looks. */
const R = 0.299;
const G = 0.587;
const B = 0.114;

/** Furthest in from any one edge the walk may go, as a fraction of that
 *  dimension. The expensive mistake here is not leaving a sliver of bar in
 *  frame, it is eating a sleeve: a dim, softly-lit photograph looks flat-ish
 *  from a distance, and a detector with no ceiling would chew through half of
 *  it. At 30% the worst case still leaves the middle 40% — a band, drawn
 *  there, is always on the picture. */
const MAX_TRIM = 0.3;

/** Largest jump in luma (0..255) allowed between neighbouring samples before a
 *  line counts as having detail in it. This is the test that does the work:
 *  what separates artwork from packing is not brightness but *edges*. A flat
 *  bar steps by nothing; a JPEG's ringing along one steps by two or three; a
 *  heavy blur, being a low-pass filter, has had its steps removed by
 *  definition. A real edge in a photograph — type, a horizon, the rim of a
 *  face — steps by tens. Ten sits in the empty space between the two. */
const FLAT_STEP = 10;

/** Largest total luma spread (0..255) a line may cover and still count as a
 *  bar. The step test alone would accept a sleeve that is one enormous smooth
 *  gradient, so this bounds how far a "smooth" line is allowed to travel: a
 *  blurred bar drifts a little, a column crossing real artwork covers most of
 *  the range. 40 of 255 is a sixth of the scale. */
const FLAT_RANGE = 40;

/** Distance between samples taken along a line. Every other pixel: fine enough
 *  that a one-pixel edge still lands between two samples that disagree, coarse
 *  enough to halve the reading. */
const LINE_PITCH = 2;

/** Perceived brightness, 0..255, of the pixel at index `i` (in pixels). */
function lumaAt(rgba: Uint8ClampedArray, i: number): number {
  return (rgba[i * 4] ?? 0) * R + (rgba[i * 4 + 1] ?? 0) * G + (rgba[i * 4 + 2] ?? 0) * B;
}

/**
 * Whether one line of pixels is packing rather than picture.
 *
 * `start` is the index of its first pixel, `stride` the step between
 * consecutive pixels along it (1 across a row, `width` down a column) and
 * `length` how many there are.
 *
 * A line with no samples is not a bar. That matters at the degenerate sizes —
 * an empty frame should come back whole, not trimmed to nothing.
 */
function isFlatLine(
  rgba: Uint8ClampedArray,
  start: number,
  stride: number,
  length: number,
): boolean {
  if (length <= 0) return false;
  let lo = Infinity;
  let hi = -Infinity;
  let previous = Number.NaN;
  for (let n = 0; n < length; n += LINE_PITCH) {
    const v = lumaAt(rgba, start + n * stride);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    if (hi - lo > FLAT_RANGE) return false;
    if (Math.abs(v - previous) > FLAT_STEP) return false;
    previous = v;
  }
  return true;
}

/**
 * The artwork's own box within a frame of packed RGBA.
 *
 * Walks in from each edge for as long as the row or column it is standing on
 * is flat, and stops at the first one with detail in it. Cheap in the case
 * that matters most — a picture with no bars fails on its very first column,
 * so a full-bleed cover costs four lines and returns the frame exactly.
 *
 * Columns are settled first and the rows are then measured only across what
 * the columns left, so a pillarbox cannot lend its own flatness to the rows
 * that cross it.
 */
export function contentBounds(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): ContentBox {
  const maxTrimX = Math.floor(width * MAX_TRIM);
  const maxTrimY = Math.floor(height * MAX_TRIM);

  let left = 0;
  while (left < maxTrimX && isFlatLine(rgba, left, width, height)) left++;
  let right = width;
  while (right > width - maxTrimX && isFlatLine(rgba, right - 1, width, height)) right--;

  const span = right - left;
  let top = 0;
  while (top < maxTrimY && isFlatLine(rgba, top * width + left, 1, span)) top++;
  let bottom = height;
  while (bottom > height - maxTrimY && isFlatLine(rgba, (bottom - 1) * width + left, 1, span)) {
    bottom--;
  }

  return { left, top, right, bottom };
}
