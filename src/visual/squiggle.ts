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
 * The taper is not decoration, it is load-bearing. Four edges that each wander
 * at their endpoints leave a box with four broken corners, which reads as a
 * rendering fault rather than a drawing. Pinned ends meet exactly, and only the
 * middles breathe.
 *
 * But a smooth line of constant weight reads as *wobbly*, not as *drawn*. What
 * makes pencil look handmade is not the waviness, it is the inconsistency, so
 * four things vary independently along every stroke:
 *
 *   1. Weight. The hand presses through the middle of a pull and lifts at the
 *      ends, unevenly, on noise of its own — never tied to where the line
 *      happens to bend.
 *   2. Contact. Graphite misses textured paper, and misses most where the pen
 *      is lightest, so the skips are placed at the thin passages rather than
 *      scattered independently. One hand, not two filters.
 *   3. Character. The four edges differ in reach and in speed, not merely in
 *      phase — a person drawing a box does not repeat themselves.
 *   4. Scale. A slow, larger drift under the ripple, so the edge wanders as
 *      well as trembles. `wobbleAt` alone is smooth by construction.
 *
 * Output is a stencil, not a picture: an SVG used as a CSS mask over a panel
 * painted `var(--line)`. The colour comes from the theme token every time and
 * no palette is baked in here at all. It is a *filled ribbon* rather than a
 * stroked line because `stroke-width` is one number for a whole path — an
 * outline is the only way a single stroke can change weight along its length.
 */

import { wobbleAt } from "./starfield";

export type Edge = "top" | "right" | "bottom" | "left";

export const EDGES: Edge[] = ["top", "right", "bottom", "left"];

export type SquiggleStyle = {
  /** Length of the stroke in viewBox units. Arbitrary — the SVG is stretched
   *  to whatever edge it lands on — so this is really just resolution. */
  length: number;
  /** Distance between sampled points. Fine enough that the ribbon's outline
   *  reads as a curve at the densest setting, coarse enough to stay small. */
  step: number;
  /** Thickness of the band the stroke lives in. The whole ribbon has to fit,
   *  or the mask crops the drawing flat. */
  band: number;
  /** Furthest the centre of the stroke may stray from the centreline. */
  amount: number;
  /** Nominal width of the line, before pressure varies it. */
  weight: number;
  /** How much of the pen's travel is spent crossing one edge. Higher means
   *  more undulations over the same distance — the only knob that separates
   *  the calm stroke from the live one. */
  span: number;
  /** Share of the sideways travel spent on the slow wander rather than the
   *  ripple. Above a half, so the edge reads as wandering with a tremble in
   *  it rather than as a wave. */
  drift: number;
  /** How much slower the wander is than the ripple. */
  driftRate: number;
  /** Keeps the wander off the ripple's own phase. */
  driftSeed: number;
  driftPhase: number;
  /** How fast the pressure noise varies along the stroke. Slow: a hand's
   *  pressure changes over the length of a pull, not letter by letter. */
  pressureRate: number;
  /** How far that noise swings the weight, either side of the lift curve. */
  pressureSwing: number;
  /** Longest a skip may be, as a share of the edge. */
  gapMin: number;
  gapMax: number;
};

/**
 * The stroke every framed surface gets.
 *
 * Deliberately the quiet end of the range. A whole interface outlined in tight
 * scribble is unreadable, and at card scale a line this calm still reads as
 * unmistakably drawn — the eye catches that the edge is not straight, and not
 * evenly inked, long before it can say why.
 */
export const CALM: SquiggleStyle = {
  length: 240,
  step: 2.5,
  band: 6,
  amount: 1.65,
  weight: 1,
  span: 5.6,
  drift: 0.58,
  driftRate: 0.22,
  driftSeed: 0.61,
  driftPhase: 12.7,
  pressureRate: 2.1,
  pressureSwing: 0.34,
  gapMin: 0.004,
  gapMax: 0.01,
};

/**
 * The one place the hand presses faster: whatever is playing right now.
 *
 * The same pen at the same weight, the same reach and the same grain — only
 * travelling further across the same edge, so the line packs in more turns.
 * One property, so the accent stays a change of energy rather than a second
 * design.
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

/**
 * How each edge differs in character, not merely in phase.
 *
 * Written out rather than derived from the seed so the spread stays reviewable:
 * four pulls by one hand, one a little shorter, one a little quicker, none of
 * them the same line rotated. The numbers are deliberately close together —
 * push them apart and the box stops looking drawn and starts looking assembled
 * out of four unrelated scraps.
 */
const CHARACTER: { amount: number; span: number; swing: number }[] = [
  { amount: 1.0, span: 1.0, swing: 1.0 },
  { amount: 0.9, span: 1.14, swing: 1.18 },
  { amount: 1.11, span: 0.88, swing: 0.86 },
  { amount: 0.95, span: 1.06, swing: 1.09 },
];

export function edgeStyle(style: SquiggleStyle, edge: Edge): SquiggleStyle {
  const c = CHARACTER[EDGES.indexOf(edge)]!;
  return {
    ...style,
    amount: style.amount * c.amount,
    span: style.span * c.span,
    pressureSwing: style.pressureSwing * c.swing,
  };
}

/**
 * How far the centre of the stroke sits off the centreline at `t`.
 *
 * Two scales at once. The ripple is `wobbleAt` as the notation uses it; under
 * it runs the same function far slower and weighted heavier, which is what
 * turns an even wave into a line that wanders and happens to tremble. Both are
 * bounded by one, and the weights sum to one, so the whole thing stays inside
 * `amount` however the two land — which is what keeps the ribbon in its band.
 */
export function acrossAt(style: SquiggleStyle, seed: number, t: number): number {
  const ripple = wobbleAt(seed, t * style.span);
  const drift = wobbleAt(seed * style.driftSeed + style.driftPhase, t * style.span * style.driftRate);
  // Pinned at both ends, wandering in between — `inkLine`'s taper, and what
  // lets four of these meet cleanly at the corners.
  return (ripple * (1 - style.drift) + drift * style.drift) * style.amount * Math.sin(t * Math.PI);
}

/** How light the pen may get before it is lifted rather than drawn. */
const LIFT_MIN = 0.55;
/** Rises off the ends quickly and stays broad through the middle — a pull is
 *  mostly at full pressure, with the lift confined to its beginning and end. */
const LIFT_POW = 0.45;
const PRESSURE_MIN = 0.28;
const PRESSURE_MAX = 1.45;
/** Far off the wobble's own phase, so weight and wander never coincide. */
const PRESSURE_SEED = 1.93;
const PRESSURE_PHASE = 31.4;

/**
 * How hard the pen is pressing at `t`, as a multiple of the nominal weight.
 *
 * Deliberately reading none of the sideways terms. If pressure came off the
 * same noise as the wobble, every bulge would sit on every bend and the stroke
 * would read as one mechanism dressed up twice; a hand's weight and its wander
 * are two independent accidents, and keeping them independent is most of what
 * sells this.
 */
export function pressureAt(style: SquiggleStyle, seed: number, t: number): number {
  const lift = LIFT_MIN + (1 - LIFT_MIN) * Math.pow(Math.sin(t * Math.PI), LIFT_POW);
  const vary = 1 + wobbleAt(seed * PRESSURE_SEED + PRESSURE_PHASE, t * style.pressureRate) * style.pressureSwing;
  return Math.min(PRESSURE_MAX, Math.max(PRESSURE_MIN, lift * vary));
}

/** Neither end may skip, whatever the noise says: a gap at a corner reads as a
 *  broken box rather than a drawn one. */
const GUARD = 0.08;
/** Where the light passages are looked for. */
const GAP_SCAN = 160;
/** Two skips closer than this read as one ragged patch rather than as grain. */
const GAP_APART = 0.16;

/** Deterministic 0..1 from any number — the fractional part is enough here,
 *  and keeps the gap widths tied to the seed rather than to a generator. */
function frac(x: number): number {
  return x - Math.floor(x);
}

/**
 * How many times the pen leaves the paper on one edge.
 *
 * One to three. Restraint is the whole game here: one or two skips read as
 * paper texture, and a dozen reads as a dashed border, which is a different
 * design that nobody asked for.
 */
function gapCount(seed: number): number {
  return 1 + Math.floor(frac(seed * 0.618) * 3);
}

/**
 * Where the stroke breaks, as spans of `t`.
 *
 * Placed at the lightest passages rather than scattered on noise of their own.
 * That coupling is the point: graphite misses paper where the hand is barely
 * touching it, so the breaks and the thin passages are two views of one
 * gesture. Scattered independently they read as a distress filter laid over
 * the top, which is exactly the grungy look this is trying not to have.
 */
export function gapsAt(style: SquiggleStyle, seed: number): { from: number; to: number }[] {
  const candidates: { t: number; p: number }[] = [];
  for (let i = 0; i <= GAP_SCAN; i++) {
    const t = GUARD + (i / GAP_SCAN) * (1 - 2 * GUARD);
    candidates.push({ t, p: pressureAt(style, seed, t) });
  }
  candidates.sort((a, b) => a.p - b.p);

  const chosen: number[] = [];
  const want = gapCount(seed);
  for (const c of candidates) {
    if (chosen.length >= want) break;
    if (chosen.some((t) => Math.abs(t - c.t) < GAP_APART)) continue;
    chosen.push(c.t);
  }
  chosen.sort((a, b) => a - b);

  return chosen.map((t, i) => {
    const width = style.gapMin + frac(seed * (i + 1) * 1.37) * (style.gapMax - style.gapMin);
    return { from: t - width / 2, to: t + width / 2 };
  });
}

/** Whether the pen is touching the paper at `t`. */
export function inkAt(style: SquiggleStyle, seed: number, t: number): boolean {
  if (t <= GUARD || t >= 1 - GUARD) return true;
  return !gapsAt(style, seed).some((g) => t > g.from && t < g.to);
}

export type Point = { x: number; y: number };
/** A sampled point on the stroke: how far along, how far off the centreline,
 *  and how wide the line is there. */
export type Ink = { along: number; across: number; half: number };

function inkAtPoint(style: SquiggleStyle, seed: number, t: number): Ink {
  return {
    along: t * style.length,
    across: acrossAt(style, seed, t),
    half: (style.weight * pressureAt(style, seed, t)) / 2,
  };
}

/**
 * The centreline, sampled — the stroke without its weight or its breaks.
 *
 * Kept because the line's path and the line's inking are separate ideas, and
 * the wander is far easier to reason about on its own.
 */
export function squigglePoints(style: SquiggleStyle, seed: number): Point[] {
  const steps = Math.round(style.length / style.step);
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({ x: t * style.length, y: style.band / 2 + acrossAt(style, seed, t) });
  }
  return points;
}

/**
 * The stroke as the runs the pen actually laid down, in order.
 *
 * Each run is sampled on the shared grid but starts and ends exactly on its
 * break rather than snapping to the nearest sample, so how long a skip is stays
 * a decision rather than a rounding artefact of the resolution.
 */
export function squiggleRuns(style: SquiggleStyle, seed: number): Ink[][] {
  const gaps = gapsAt(style, seed);
  const spans: [number, number][] = [];
  let cursor = 0;
  for (const g of gaps) {
    spans.push([cursor, g.from]);
    cursor = g.to;
  }
  spans.push([cursor, 1]);

  const steps = Math.round(style.length / style.step);
  const runs: Ink[][] = [];
  for (const [from, to] of spans) {
    if (to - from <= 1e-6) continue;
    const ts = [from];
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (t > from + 1e-9 && t < to - 1e-9) ts.push(t);
    }
    ts.push(to);
    if (ts.length >= 2) runs.push(ts.map((t) => inkAtPoint(style, seed, t)));
  }
  return runs;
}

/** Two decimals is well under a device pixel once the stroke is scaled to an
 *  edge, and it keeps the stencils short enough to sit in a stylesheet. */
function round(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * One run as a closed outline: out along one side of the ribbon and back along
 * the other.
 *
 * The two sides are offset squarely across the band rather than perpendicular
 * to the path, which is not a shortcut — the stencil is stretched along its
 * length when it is used, so the only offset that survives as a constant
 * visible thickness is the one across the band.
 */
function ribbon(style: SquiggleStyle, run: Ink[], vertical: boolean): string {
  const mid = style.band / 2;
  const at = (p: Ink, side: number) => {
    const across = mid + p.across + side * p.half;
    const [x, y] = vertical ? [across, p.along] : [p.along, across];
    return `${round(x)},${round(y)}`;
  };
  const out = run.map((p) => at(p, 1));
  const back = [...run].reverse().map((p) => at(p, -1));
  return `M${out.join("L")}L${back.join("L")}Z`;
}

/**
 * The stroke as a standalone SVG.
 *
 * `preserveAspectRatio='none'` is the whole trick: the stroke is drawn once and
 * stretched to whatever edge it lands on, so a wide card gets a long lazy line
 * and a narrow one gets a tighter one — the way a longer edge really does take
 * a longer stroke. Only the length scales; the band is fixed in pixels, so the
 * weight of the line and how far it strays never change with the size of the
 * box.
 *
 * Filled black because this is an alpha stencil, not a picture: opaque means
 * "reveal here". Every visible colour comes from the token behind the mask,
 * which is why one set of stencils serves both themes.
 */
export function squiggleSvg(style: SquiggleStyle, edge: Edge): string {
  const s = edgeStyle(style, edge);
  const vertical = edge === "left" || edge === "right";
  const w = vertical ? s.band : s.length;
  const h = vertical ? s.length : s.band;
  const d = squiggleRuns(s, edgeSeed(style, edge))
    .map((run) => ribbon(s, run, vertical))
    .join("");
  return (
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'` +
    ` viewBox='0 0 ${w} ${h}' preserveAspectRatio='none'>` +
    `<path d='${d}' fill='black'/></svg>`
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
