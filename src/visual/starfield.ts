/**
 * A field of twinkling stars with the occasional asteroid crossing it.
 *
 * Motion maths only — no canvas, no DOM. Everything here is a pure function of
 * time, which is what makes the field reproducible from a seed and testable
 * without waiting for frames.
 */

export type Star = {
  x: number;
  y: number;
  /** Dot radius in pixels. */
  size: number;
  /** Where in its own twinkle cycle this star starts. */
  phase: number;
  /** Radians per millisecond. */
  rate: number;
  /** Drawn as an outline rather than filled — a few of these keep the field
   *  from reading as a single repeated stamp. */
  outlined: boolean;
  /** Seeds the wobble, so this star is drawn by its own hand — and drawn the
   *  same way on every repaint rather than shivering. */
  seed: number;
};

export type Asteroid = {
  x: number;
  y: number;
  /** Pixels per millisecond. */
  vx: number;
  vy: number;
  /** Trail length in pixels. */
  length: number;
};

/** How far past the edge an asteroid must travel before it is retired. */
const SPENT_MARGIN = 240;

export function makeStars(
  count: number,
  width: number,
  height: number,
  rand: () => number,
): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rand() * width,
      y: rand() * height,
      // A range of sizes: a sky of one size reads as a grid, not a sky. The
      // few large ones are what the eye actually lands on.
      size: (() => {
        const r = rand();
        if (r < 0.7) return 2.2;
        if (r < 0.94) return 4;
        return 7;
      })(),
      // Its own phase, or the whole sky pulses in unison — the classic tell
      // of a fake starfield.
      phase: rand() * Math.PI * 2,
      rate: 0.0006 + rand() * 0.0018,
      outlined: rand() < 0.28,
      seed: rand() * 1000,
    });
  }
  return stars;
}

/** 0..1, where 1 is fully lit. */
export function starBrightness(star: Star, timeMs: number): number {
  return (Math.sin(star.phase + timeMs * star.rate) + 1) / 2;
}

/**
 * Cheap repeatable noise: the one pen everything in the field is drawn with.
 *
 * A pure function of a seed and a position along the stroke, on purpose — the
 * field is repainted every frame, so a wobble that came out of a random number
 * generator would make the whole sky vibrate. Three sines stacked, so the line
 * drifts like a wrist rather than jittering like a bad signal. Roughly -1..1.
 */
export function wobbleAt(seed: number, t: number): number {
  return (
    Math.sin(seed + t * 5.1) * 0.6 +
    Math.sin(seed * 1.7 + t * 11.3) * 0.3 +
    Math.sin(seed * 0.3 + t * 23.7) * 0.1
  );
}

export type Point = { x: number; y: number };

/**
 * A sparkle as points around its own centre, in the order the pen visits them:
 * start at `start`, then for each side pinch in at its `waist` and out to its
 * `tip`. The last side's tip is `start` again, so the outline closes.
 */
export type SparkleShape = {
  start: Point;
  sides: { waist: Point; tip: Point }[];
};

/** North, east, south, west. */
const ARMS = 4;
/** How far an arm may run long or short, as a share of the radius. */
const REACH_WOBBLE = 0.18;
/** How far an arm may lean off its own quarter, in radians. */
const LEAN_WOBBLE = 0.16;
/** How far a side's pinch may sit off the centre, as a share of the radius. */
const WAIST_WOBBLE = 0.22;

/**
 * The four-pointed sparkle, drawn by the same hand as the notation.
 *
 * Points north, east, south and west with each side pulled in toward the centre
 * so the arms taper. That concave curve is the whole character of the shape: a
 * straight-sided version is a diamond, which reads as a gem rather than a
 * glint.
 *
 * Nothing about it is symmetric. Each arm runs its own length and leans off its
 * quarter, and each side is pinched at its own point rather than all four at
 * dead centre — the same unevenness `inkLine` gives a staff line, out of the
 * same `wobbleAt`. Seeded by the star, so it is drawn identically on every
 * repaint; nudged by `drift`, so it can be drawn *again*, a little differently,
 * as the star twinkles.
 *
 * Points come out relative to the centre — the caller puts them on the page.
 */
export function sparkleShape(seed: number, radius: number, drift: number): SparkleShape {
  const tips: Point[] = [];
  const waists: Point[] = [];
  for (let i = 0; i < ARMS; i++) {
    const at = i / ARMS + drift;
    const reach = radius * (1 + wobbleAt(seed, at) * REACH_WOBBLE);
    const angle = (i / ARMS) * Math.PI * 2 - Math.PI / 2 + wobbleAt(seed * 1.31 + 4.2, at) * LEAN_WOBBLE;
    tips.push({ x: Math.cos(angle) * reach, y: Math.sin(angle) * reach });
    waists.push({
      x: wobbleAt(seed * 0.77 + 1.9, at) * radius * WAIST_WOBBLE,
      y: wobbleAt(seed * 2.13 + 8.4, at) * radius * WAIST_WOBBLE,
    });
  }
  // Side i runs from tip i to the next one, pinched at waist i on the way.
  const start = tips[0]!;
  return {
    start,
    sides: waists.map((waist, i) => ({ waist, tip: tips[(i + 1) % ARMS]! })),
  };
}

/**
 * How fast the drawing hand drifts, as a fraction of a star's own twinkle.
 *
 * Well under it. The point is that the star reads as having been drawn again
 * as it swells, not that it has a second animation of its own — push this up
 * and the field starts to shiver, which is exactly what the seeded wobble
 * exists to prevent.
 */
const HAND_RATE = 0.045;

/**
 * Where this star's drawing hand has drifted to at `timeMs`.
 *
 * Fed to `sparkleShape` as its drift, so a twinkling star is redrawn slightly
 * differently rather than one fixed outline being zoomed in and out — which is
 * the difference between a drawing and a sticker. Continuous, never stepped: a
 * star that cut between poses reads as a glitch.
 *
 * Offset by the star's own seed, so no two stars are mid-way through the same
 * stroke, and at t = 0 it settles onto a fixed hand — which is what a
 * reduced-motion field paints.
 */
export function starHand(star: Star, timeMs: number): number {
  return star.seed * 0.13 + timeMs * star.rate * HAND_RATE;
}

/**
 * A new asteroid, starting outside the field.
 *
 * Off-screen on purpose: spawning inside the viewport makes a streak appear
 * out of nothing in the middle of the sky, which reads as a glitch rather
 * than a meteor.
 */
export function spawnAsteroid(width: number, height: number, rand: () => number): Asteroid {
  const speed = 0.35 + rand() * 0.45;
  // Down and to one side, the angle a meteor actually falls at.
  const goingRight = rand() < 0.5;
  const angle = (goingRight ? 0.35 : 0.65) * Math.PI + (rand() - 0.5) * 0.4;
  return {
    x: goingRight ? -SPENT_MARGIN * rand() - 20 : width + SPENT_MARGIN * rand() + 20,
    y: -20 - rand() * height * 0.5,
    vx: Math.cos(angle) * speed * (goingRight ? -1 : 1),
    vy: Math.abs(Math.sin(angle)) * speed,
    length: 40 + rand() * 90,
  };
}

/** Time-based, not frame-based, so it travels at the same speed on a 60Hz
 *  panel and a 120Hz one. */
export function stepAsteroid(a: Asteroid, dtMs: number): Asteroid {
  return { ...a, x: a.x + a.vx * dtMs, y: a.y + a.vy * dtMs };
}

export function isSpent(a: Asteroid, width: number, height: number): boolean {
  return (
    a.y > height + SPENT_MARGIN ||
    a.x < -SPENT_MARGIN ||
    a.x > width + SPENT_MARGIN
  );
}

/** Share of the width at each edge that staves may occupy. The middle is
 *  where the app's cards sit, and notation behind a card is just noise the
 *  reader has to see past. Exported so the rule lives in one place rather
 *  than being restated as a magic number wherever it is checked. */
export const STAVE_EDGE_BAND = 0.38;

/** A fragment of hand-drawn staff sitting somewhere in the field. */
export type Stave = {
  x: number;
  y: number;
  width: number;
  /** Gap between staff lines; everything else scales off it. */
  spacing: number;
  /** Radians. Kept small — a staff at a jaunty angle reads as a sticker. */
  tilt: number;
  /** Seeds the wobble so each stave is drawn a little differently. */
  seed: number;
  notes: Note[];
};

export type Note = {
  /** 0..1 along the stave. */
  at: number;
  /** Staff steps from the middle line; negative is higher. */
  step: number;
  /** Hollow, like a minim. */
  open: boolean;
};

/**
 * Scatter staff fragments across the field.
 *
 * Placed away from the vertical middle band on purpose: that is where the app's
 * own cards sit, and notation behind a card is just noise the reader has to
 * see past.
 */
/** Attempts to find clear space before a stave is given up on. Bounded so a
 *  crowded field cannot spin: dropping a fragment is cheaper than looping. */
const PLACEMENT_TRIES = 24;

/** Vertical reach of a drawn stave in multiples of its line spacing — five
 *  lines plus the stems and ledger lines that run past them. */
const STAVE_REACH = 4;

type Box = { x1: number; x2: number; y1: number; y2: number };

function boxOf(x: number, y: number, width: number, spacing: number): Box {
  const reach = spacing * STAVE_REACH;
  return { x1: x, x2: x + width, y1: y - reach, y2: y + reach };
}

function hits(a: Box, b: Box): boolean {
  return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
}

/**
 * Scatter staff fragments across the field, none of them touching.
 *
 * Placed away from the vertical middle band on purpose: that is where the
 * app's cards sit, and notation behind a card is just noise the reader has to
 * see past.
 *
 * Positions are rejection-sampled against what is already down. Two fragments
 * of notation crossing reads as a printing error rather than as texture, so a
 * stave that cannot find clear space is dropped instead — the count is a
 * ceiling, not a quota.
 */
export function makeStaves(
  count: number,
  width: number,
  height: number,
  rand: () => number,
): Stave[] {
  const staves: Stave[] = [];
  const taken: Box[] = [];

  for (let i = 0; i < count; i++) {
    const spacing = 5 + rand() * 4;
    const w = 80 + rand() * 210;

    let placed: { x: number; y: number } | null = null;
    for (let attempt = 0; attempt < PLACEMENT_TRIES; attempt++) {
      const leftSide = rand() < 0.5;
      const x = leftSide
        ? rand() * (width * STAVE_EDGE_BAND)
        : width * (1 - STAVE_EDGE_BAND) + rand() * (width * STAVE_EDGE_BAND - w * 0.25);
      const y = rand() * height;
      const box = boxOf(x, y, w, spacing);
      if (!taken.some((other) => hits(box, other))) {
        taken.push(box);
        placed = { x, y };
        break;
      }
    }
    if (!placed) continue;

    const noteCount = 3 + Math.floor(rand() * 5);
    const notes: Note[] = [];
    for (let n = 0; n < noteCount; n++) {
      notes.push({
        at: (n + 0.5 + (rand() - 0.5) * 0.35) / noteCount,
        step: Math.round((rand() - 0.5) * 8),
        open: rand() < 0.25,
      });
    }

    staves.push({
      x: placed.x,
      y: placed.y,
      width: w,
      spacing,
      tilt: (rand() - 0.5) * 0.14,
      seed: rand() * 1000,
      notes,
    });
  }
  return staves;
}
