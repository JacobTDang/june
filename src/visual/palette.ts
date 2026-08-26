/** A colour taken from the artwork, with how much of the image it covers. */
export type Swatch = { r: number; g: number; b: number; share: number };

/** Bits dropped per channel when bucketing. Five bits per channel gives 32
 *  levels — enough to keep distinct colours apart, coarse enough that noise
 *  and JPEG artefacts land in the same bucket as the colour they belong to. */
const QUANT = 3;
/** Sample stride. Album art is small and this runs once per track; stepping
 *  keeps it well under a frame even so. */
const STRIDE = 2;

function chroma(r: number, g: number, b: number): number {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

/**
 * The colours an artwork is actually made of, most prominent first.
 *
 * Weighted toward chroma rather than raw frequency. The sleeve is already
 * rendered as a one-bit dither, so the bloom's whole job is to supply what
 * that rendering cannot — a wash of the album's greys would add nothing. A
 * genuinely monochrome sleeve still returns its greys rather than nothing, so
 * the caller always has something to work with.
 */
export function dominantColors(rgba: Uint8ClampedArray, count: number): Swatch[] {
  const pixels = Math.floor(rgba.length / 4);
  if (pixels === 0 || count <= 0) return [];

  const buckets = new Map<number, { r: number; g: number; b: number; n: number }>();
  let counted = 0;

  for (let i = 0; i < pixels; i += STRIDE) {
    const a = rgba[i * 4 + 3]!;
    if (a < 8) continue;
    const r = rgba[i * 4]!;
    const g = rgba[i * 4 + 1]!;
    const b = rgba[i * 4 + 2]!;
    const key = ((r >> QUANT) << 10) | ((g >> QUANT) << 5) | (b >> QUANT);
    const slot = buckets.get(key);
    if (slot) {
      slot.r += r;
      slot.g += g;
      slot.b += b;
      slot.n += 1;
    } else {
      buckets.set(key, { r, g, b, n: 1 });
    }
    counted += 1;
  }
  if (counted === 0) return [];

  const swatches = [...buckets.values()].map((s) => ({
    r: Math.round(s.r / s.n),
    g: Math.round(s.g / s.n),
    b: Math.round(s.b / s.n),
    share: s.n / counted,
  }));

  return swatches
    .sort((a, b) => {
      // Chroma is a multiplier on share rather than a filter: a vivid colour
      // covering a tenth of the sleeve should beat a neutral covering half,
      // but a sleeve with no vivid colour at all still ranks its greys.
      const score = (s: Swatch) => s.share * (1 + (chroma(s.r, s.g, s.b) / 255) * 6);
      return score(b) - score(a);
    })
    .slice(0, count);
}
