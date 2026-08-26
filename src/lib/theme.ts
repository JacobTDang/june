/** What actually gets painted. */
export type Theme = "light" | "dark";

/** Namespaced so it cannot collide with the other june keys in localStorage. */
export const STORAGE_KEY = "june:theme";

/** june is dark out of the box; light is something you opt into. */
export const DEFAULT_THEME: Theme = "dark";

/**
 * The theme to paint, from whatever localStorage holds.
 *
 * Anything unrecognised falls back to the default rather than throwing or
 * leaving the page unthemed: localStorage is user-writable, survives deploys,
 * and may still hold values from an earlier cut of this feature.
 */
export function readTheme(raw: string | null): Theme {
  return raw === "light" || raw === "dark" ? raw : DEFAULT_THEME;
}

/** Toggling is explicit: flip away from whatever is currently on screen. */
export function nextTheme(current: Theme): Theme {
  return current === "dark" ? "light" : "dark";
}

/**
 * Radius a circle centred at (x, y) needs to cover a w by h viewport — the
 * distance to whichever corner is farthest.
 *
 * The toggle sits in a top corner, so the reveal has to grow all the way to
 * the opposite one. Sizing it off the nearest corner, or off half the
 * diagonal, leaves a wedge of the old theme still on screen when the
 * animation ends.
 */
export function coverRadius(x: number, y: number, w: number, h: number): number {
  return Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
}
