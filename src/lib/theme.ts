/** What the viewer has asked for. "system" is the default: no choice made. */
export type ThemeChoice = "light" | "dark" | "system";
/** What actually gets painted. */
export type Theme = "light" | "dark";

/** Namespaced so it cannot collide with the other june keys in localStorage. */
export const STORAGE_KEY = "june:theme";

/** The theme to paint, given the stored choice and what the OS is asking for. */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): Theme {
  if (choice === "system") return prefersDark ? "dark" : "light";
  return choice;
}

/**
 * A stored value read back as a choice. localStorage is user-writable and
 * survives deploys, so anything unrecognised has to degrade to "system"
 * rather than leave the page with no theme at all.
 */
export function readChoice(raw: string | null): ThemeChoice {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

/** Toggling is explicit: flip away from whatever is currently on screen. */
export function nextChoice(current: Theme): ThemeChoice {
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
