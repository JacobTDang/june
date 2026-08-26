/** Attribute set on <html> while the theme reveal is running. */
export const REVEALING_ATTR = "data-revealing";

/**
 * Whether a theme reveal is mid-flight.
 *
 * During a view transition only the captured snapshots are on screen, so any
 * canvas still running its loop is painting where nobody can see it - while
 * competing for the main thread with the reveal, which animates clip-path and
 * therefore cannot run on the compositor. The room has two such loops, one of
 * them doing getImageData/putImageData every frame; the home page has none,
 * which is why the reveal was smooth there and jumped in a room.
 */
export function isRevealing(): boolean {
  return typeof document !== "undefined" && document.documentElement.hasAttribute(REVEALING_ATTR);
}

/**
 * Fraction of a w by h viewport inside a circle centred on its top-right
 * corner.
 *
 * The circle covers a quarter disc, so its area grows as the *square* of the
 * radius: at half the radius it has covered a quarter of the screen. That is
 * why animating the radius linearly reads as a wipe that crawls and then
 * floods once it is past the middle.
 */
export function coveredFraction(r: number, w: number, h: number): number {
  if (r <= 0) return 0;
  const width = Math.min(w, r);
  if (width <= 0) return 0;
  // Integrate the circle's height across the viewport, clamped to it - a plain
  // quarter-disc formula is only right until the circle runs past an edge, and
  // most of the animation happens after that.
  const slices = 512;
  const du = width / slices;
  let area = 0;
  for (let i = 0; i < slices; i++) {
    const u = (i + 0.5) * du;
    area += Math.min(h, Math.sqrt(Math.max(0, r * r - u * u)));
  }
  return (area * du) / (w * h);
}

/**
 * Radius, as a fraction of the distance to the far corner, at each tenth of
 * the reveal - chosen so the *screen* fills at a near-even rate rather than
 * the radius growing evenly.
 *
 * Derived by inverting coveredFraction across common viewports and averaging,
 * which is why the numbers are not a tidy curve. Held to a near-even fill by
 * the tests: 1.1-1.3x on laptop shapes against 7-13x for a linear radius. They
 * are duplicated into the theme-reveal keyframes in globals.css so the reveal
 * needs no JS maths at runtime; a test asserts the two still agree.
 */
export const REVEAL_STOPS: number[] = [
  0.236, 0.334, 0.409, 0.473, 0.535, 0.603, 0.674, 0.747, 0.827, 1,
];
