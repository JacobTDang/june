/**
 * Pure spectrum-to-visual mapping for the room player's pixel-grid
 * visualizer. No DOM/AudioContext access here — callers hand this module
 * the raw analyser bytes each frame and get back column intensities to
 * paint, which keeps the mapping unit-testable without any audio APIs.
 */

export interface SpectrumConfig {
  /** Number of output columns (visualizer columns). */
  columns: number;
  /** Exponential smoothing factor 0..1 applied against previous frame (0 = no smoothing). */
  smoothing: number;
}

/**
 * Fold raw analyser frequency bins (Uint8Array, 0-255 per bin) into
 * `columns` perceptual bands (log-spaced: low columns get few bins, high
 * columns get many), normalized to 0..1, smoothed against `previous`.
 * Returns a new array of length `columns`; does not mutate inputs.
 */
export function spectrumColumns(
  bins: Uint8Array,
  previous: readonly number[] | null,
  config: SpectrumConfig,
): number[] {
  if (bins.length === 0) {
    throw new Error("spectrumColumns: bins must not be empty");
  }
  if (config.columns < 1) {
    throw new Error("spectrumColumns: columns must be at least 1");
  }

  const current = bandMeans(bins, config.columns);

  if (previous === null || config.smoothing === 0) {
    return current;
  }

  const { smoothing } = config;
  return current.map((value, i) => (previous[i] ?? 0) * smoothing + value * (1 - smoothing));
}

/** True when every bin is zero — the signal of a tainted/blocked audio tap. */
export function isSilentFrame(bins: Uint8Array): boolean {
  for (let i = 0; i < bins.length; i++) {
    if (bins[i] !== 0) return false;
  }
  return true;
}

/** Mean of each log-spaced band, normalized to 0..1. */
function bandMeans(bins: Uint8Array, columns: number): number[] {
  const boundaries = bandBoundaries(bins.length, columns);
  const means: number[] = new Array(columns);
  for (let c = 0; c < columns; c++) {
    const start = boundaries[c]!;
    const end = boundaries[c + 1]!;
    let sum = 0;
    for (let i = start; i < end; i++) sum += bins[i]!;
    const mean = sum / (end - start);
    means[c] = Math.min(1, Math.max(0, mean / 255));
  }
  return means;
}

/**
 * Log-spaced bin boundaries for `columns` bands over `totalBins` bins.
 * boundaries[0] = 0 and boundaries[columns] = totalBins; each step in
 * between grows exponentially (base = totalBins^(1/columns)) so low
 * columns cover a handful of bass bins and high columns sweep across many
 * treble bins, matching how pitch is perceived. The min/max clamps keep
 * every band non-empty even where rounding would otherwise collide with
 * or skip past a neighboring boundary.
 */
function bandBoundaries(totalBins: number, columns: number): number[] {
  const base = Math.pow(totalBins, 1 / columns);
  const boundaries: number[] = [0];
  for (let c = 1; c < columns; c++) {
    const raw = Math.round(Math.pow(base, c));
    const minNext = boundaries[c - 1]! + 1; // every band gets at least one bin
    const maxNext = totalBins - (columns - c); // leave >= 1 bin for each remaining band
    boundaries.push(Math.min(Math.max(raw, minNext), Math.max(maxNext, minNext)));
  }
  boundaries.push(totalBins);
  return boundaries;
}
