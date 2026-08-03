/** Dot-field geometry for the visualizer: how many columns and rows of dots
 *  fill a card of a given size. Pure geometry, kept out of the component so
 *  the sizing rules are testable on their own. */

/** Rough spacing between dots. Cols and rows both derive from it, which is
 *  what keeps cells square whatever shape the card is. */
const TARGET_CELL_PX = 13;

const MIN_COLUMNS = 12;
const MIN_ROWS = 4;

/** Upper bound on columns: each column samples one spectrum band, so this
 *  must stay within the analyser's bin count (asserted where FFT_SIZE is
 *  defined, in the visualizer component). */
export const MAX_COLUMNS = 70;

/** Dots drawn per frame, across every size. The stage now grows with the
 *  viewport, so an unbounded grid would quietly scale the per-frame arc count
 *  with the window — this caps the work instead, trading a little density on
 *  very large screens for a steady frame rate. */
export const MAX_DOTS = 2600;

export interface Grid {
  cols: number;
  rows: number;
}

/**
 * Columns and rows for a card of `width` x `height`. Both axes are derived
 * from the same target spacing and scaled together when the dot budget bites,
 * so cells stay near-square instead of stretching along the longer axis.
 */
export function computeGrid(width: number, height: number): Grid {
  // Pick one cell size, then derive both axes from it — that is what makes
  // the cells square by construction. Each term is a floor the spacing has to
  // clear: the target spacing itself, the width per column at the column cap,
  // and the spacing at which the whole card fits inside the dot budget.
  const cell = Math.max(
    TARGET_CELL_PX,
    width / MAX_COLUMNS,
    Math.sqrt((width * height) / MAX_DOTS),
  );

  return {
    // Floor rather than round: rounding up on both axes can push the product
    // just past the budget the cell size was chosen to satisfy.
    cols: clamp(Math.floor(width / cell), MIN_COLUMNS, MAX_COLUMNS),
    rows: Math.max(MIN_ROWS, Math.floor(height / cell)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
