/** Keeping the chat composer on the same line as the search bar.
 *
 *  The two live in different columns whose content starts at different
 *  heights, and the centre column's height *moves*: the now-playing block only
 *  exists while something is playing, so the search bar drops about 85px the
 *  moment a track starts. A fixed height can't track that, so the room
 *  measures both and sizes the chat log to suit. This is the arithmetic. */

/** Below this the log is too short to read, and alignment stops being worth
 *  it — a working chat beats a tidy line. */
export const MIN_CHAT_LOG_PX = 120;

/**
 * How tall the chat log must be for the composer beneath it to start exactly
 * where the search bar starts.
 *
 * `gap` is the composer's own top margin, which sits between the log and it.
 */
export function alignedLogHeight({
  searchTop,
  logTop,
  gap,
}: {
  /** Viewport-relative top of the search bar. */
  searchTop: number;
  /** Viewport-relative top of the chat log. */
  logTop: number;
  gap: number;
}): number {
  return Math.max(MIN_CHAT_LOG_PX, Math.round(searchTop - logTop - gap));
}
