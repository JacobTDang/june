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
    });
  }
  return stars;
}

/** 0..1, where 1 is fully lit. */
export function starBrightness(star: Star, timeMs: number): number {
  return (Math.sin(star.phase + timeMs * star.rate) + 1) / 2;
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
