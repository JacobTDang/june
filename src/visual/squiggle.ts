/**
 * The pen that draws the notation, let out of the canvas and onto the frames.
 *
 * june already had a hand. `inkLine` in the starfield walks a staff line and
 * pushes every point sideways by `wobbleAt` — three stacked sines, seeded, so
 * a stroke drifts like a wrist instead of jittering like a bad signal — then
 * tapers it by `sin(t·π)` so the ends stay pinned and only the middle wanders.
 * That hand stopped at the canvas: every border in the DOM was machine-straight
 * while the notation behind it was drawn. This closes that gap, using the same
 * `wobbleAt` rather than a lookalike, so a card's edge and a staff line come
 * off one nib.
 *
 * The taper is not decoration here, it is the load-bearing part. Four edges
 * that each wander at their endpoints leave a box with four broken corners,
 * which reads as a rendering fault rather than a drawing. Pinned ends meet
 * exactly, and only the middles breathe — which is both the house style and
 * the structurally correct answer.
 *
 * Output is a stencil, not a picture: an SVG of one stroke, used as a CSS
 * mask over a panel painted `var(--line)`. The colour therefore comes from the
 * theme token every time and there is no palette baked in here at all.
 */

import { wobbleAt } from "./starfield";

export type Edge = "top" | "right" | "bottom" | "left";

export const EDGES: Edge[] = ["top", "right", "bottom", "left"];

export type SquiggleStyle = {
  /** Length of the stroke in viewBox units. Arbitrary — the SVG is stretched
   *  to whatever edge it lands on — so this is really just resolution. */
  length: number;
  /** Distance between sampled points. Small enough that the polyline reads as
   *  a curve, large enough that the data URI stays a few hundred bytes. */
  step: number;
  /** Thickness of the band the stroke lives in. The stroke is centred in it,
   *  and the whole wobble has to fit, or the mask crops the drawing flat. */
  band: number;
  /** Furthest the middle of the stroke may stray from the centreline. */
  amount: number;
  /** Stroke width, matching the 1px hairline it stands in for. */
  weight: number;
  /** How much of the pen's travel is spent crossing one edge. Higher means
   *  more undulations over the same distance — this is the only knob that
   *  separates the calm stroke from the live one. */
  span: number;
};

/**
 * The stroke every framed surface gets.
 *
 * Deliberately the quiet end of the range. A whole interface outlined in tight
 * scribble is unreadable, and at card scale a line this calm still reads as
 * unmistakably drawn — the eye catches that the edge is not straight long
 * before it can say why.
 */
export const CALM: SquiggleStyle = {
  length: 240,
  step: 6,
  band: 6,
  amount: 1.9,
  weight: 1,
  span: 5.6,
};

/**
 * The one place the hand presses faster: whatever is playing right now.
 *
 * The same pen at the same weight and the same reach — only travelling further
 * across the same edge, so the line packs in more turns. One property, so the
 * accent stays a change of energy rather than a second design.
 */
export const LIVE: SquiggleStyle = { ...CALM, span: 7.4 };

/** Kept apart by an awkward number so no two edges of a box share a phase —
 *  opposite sides drawn in sync is the tell that a machine drew them. */
const SEED_GAP = 17.31;
const SEED_BASE = 4.7;

/** Every edge is drawn by its own hand, and always the same one. */
export function edgeSeed(_style: SquiggleStyle, edge: Edge): number {
  return SEED_BASE + EDGES.indexOf(edge) * SEED_GAP;
}

export type Point = { x: number; y: number };

/**
 * One stroke, sampled along a horizontal edge.
 *
 * `x` runs the length of the edge; `y` is the offset within the band. Callers
 * that want a vertical edge swap the pair — the drawing is the same, turned on
 * its side, which is what a hand does when it draws the sides of a box.
 */
export function squigglePoints(style: SquiggleStyle, seed: number): Point[] {
  const { length, step, band, amount, span } = style;
  const steps = Math.max(2, Math.round(length / step));
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Pinned at both ends, wandering in between — `inkLine`'s taper, and what
    // lets four of these meet cleanly at the corners.
    const taper = Math.sin(t * Math.PI);
    points.push({
      x: t * length,
      y: band / 2 + wobbleAt(seed, t * span) * amount * taper,
    });
  }
  return points;
}

/** Two decimals is well under a device pixel once the stroke is scaled to an
 *  edge, and it keeps the data URIs short enough to read in the stylesheet. */
function round(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function pathData(style: SquiggleStyle, seed: number, vertical: boolean): string {
  return squigglePoints(style, seed)
    .map(({ x, y }, i) => {
      // A vertical edge is the same stroke stood on end.
      const [px, py] = vertical ? [y, x] : [x, y];
      return `${i === 0 ? "M" : "L"}${round(px)},${round(py)}`;
    })
    .join("");
}

/**
 * The stroke as a standalone SVG.
 *
 * `preserveAspectRatio='none'` is the whole trick: the stroke is drawn once and
 * stretched to whatever edge it lands on, so a wide card gets a long lazy line
 * and a narrow one gets a tighter one — the way a longer edge really does take
 * a longer stroke. Only the length scales; the band is fixed in pixels, so the
 * line's weight and how far it strays never change with the size of the box.
 *
 * The stroke is painted black because this is an alpha stencil, not a picture:
 * opaque means "reveal here". Every visible colour comes from the token behind
 * the mask, which is why the same stencil serves both themes.
 */
export function squiggleSvg(style: SquiggleStyle, edge: Edge): string {
  const vertical = edge === "left" || edge === "right";
  const w = vertical ? style.band : style.length;
  const h = vertical ? style.length : style.band;
  const d = pathData(style, edgeSeed(style, edge), vertical);
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'` +
    ` viewBox='0 0 ${w} ${h}' preserveAspectRatio='none'>` +
    `<path d='${d}' fill='none' stroke='black' stroke-width='${style.weight}'` +
    ` stroke-linecap='round' stroke-linejoin='round'/></svg>`
  );
}

/** Only what would end a `url()` early, start a comment, or confuse a parser.
 *  Everything else is left legible so the stylesheet can still be read. */
const ESCAPES: [RegExp, string][] = [
  [/%/g, "%25"],
  [/</g, "%3C"],
  [/>/g, "%3E"],
  [/#/g, "%23"],
  [/"/g, "%22"],
  [/'/g, "%27"],
  [/ /g, "%20"],
];

/** The stroke as a value that can be pasted straight into the stylesheet. */
export function squiggleUrl(style: SquiggleStyle, edge: Edge): string {
  const svg = ESCAPES.reduce((s, [from, to]) => s.replace(from, to), squiggleSvg(style, edge));
  return `url("data:image/svg+xml,${svg}")`;
}
