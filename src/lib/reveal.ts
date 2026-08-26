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
