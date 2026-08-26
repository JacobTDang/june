/**
 * Swipe-to-remove for a queue row: the arithmetic behind the gesture, kept out
 * of the component so it can be reasoned about on its own.
 *
 * A queue row is asked to serve three gestures at once — the page scrolls
 * through it, its handle reorders it, and a sideways drag removes it — so the
 * interesting part isn't the movement, it's deciding whose gesture this is
 * before committing to any of them.
 */

/** How far a finger travels before the gesture is read as having an axis at
 *  all. Under this it's a tap, or the first pixel of a scroll. */
export const SWIPE_SLOP_PX = 10;

/** Share of the row's width that a swipe has to cover to remove it. */
export const SWIPE_COMMIT_FRACTION = 0.35;
/** Floor and ceiling on that distance: a third of a phone rail is a sensible
 *  ask, a third of a wide desktop rail is a marathon, and a third of a very
 *  narrow row is a twitch. */
export const SWIPE_COMMIT_MIN_PX = 40;
export const SWIPE_COMMIT_MAX_PX = 120;

/** How far a leftward pull is allowed to drag the row. There is nothing to the
 *  left of it, so the row resists rather than following. */
export const SWIPE_RESIST_PX = 16;

/** How long a row takes to leave, by swipe or by the remove button. */
export const ROW_EXIT_MS = 200;

/** The stylesheet's --ease, so a row leaves on the same curve as the rest of
 *  the app. Ease-out: quick off the mark, settling at the end. */
const EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];

export type SwipeAxis = "undecided" | "horizontal" | "vertical";

/**
 * Whose gesture is this? "vertical" means hands off — the page (or the queue's
 * own scroller) is scrolling and the row must not move. Ties go to scrolling:
 * it's the gesture people make a hundred times a session, and the one that
 * hurts most when something steals it.
 */
export function swipeAxis(dx: number, dy: number): SwipeAxis {
  const x = Math.abs(dx);
  const y = Math.abs(dy);
  if (Math.max(x, y) < SWIPE_SLOP_PX) return "undecided";
  return x > y ? "horizontal" : "vertical";
}

/** Where the row sits, given how far the finger has moved from where it went
 *  down. Rightward is followed exactly; leftward gets a short rubber band. */
export function swipeOffset(dx: number): number {
  if (dx >= 0) return dx;
  return Math.max(dx / 3, -SWIPE_RESIST_PX);
}

/** How far this row has to be swiped before letting go removes it. */
export function swipeCommitDistance(rowWidth: number): number {
  if (!Number.isFinite(rowWidth) || rowWidth <= 0) return SWIPE_COMMIT_MIN_PX;
  const wanted = rowWidth * SWIPE_COMMIT_FRACTION;
  return Math.min(Math.max(wanted, SWIPE_COMMIT_MIN_PX), SWIPE_COMMIT_MAX_PX);
}

/** What letting go means: the row goes, or it springs back. */
export function swipeRelease(dx: number, rowWidth: number): "remove" | "return" {
  return dx >= swipeCommitDistance(rowWidth) ? "remove" : "return";
}

export type RowExit = {
  x?: string;
  opacity: number;
  transition: { duration: number; ease?: [number, number, number, number] };
};

/**
 * How a row leaves the queue: out to the right, in about a fifth of a second.
 * Asked for less motion, it simply stops being there — no travel, no fade.
 */
export function rowExit(reduce: boolean): RowExit {
  if (reduce) return { opacity: 0, transition: { duration: 0 } };
  return {
    x: "110%",
    opacity: 0,
    transition: { duration: ROW_EXIT_MS / 1000, ease: EASE },
  };
}
