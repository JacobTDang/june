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
