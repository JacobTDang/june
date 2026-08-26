/**
 * How many messages have arrived that the reader has not had in front of them.
 *
 * Clamped at zero rather than trusted: a room can be reset or a message
 * removed, leaving fewer messages than were already seen, and a negative badge
 * is worse than no badge.
 */
export function unreadCount({
  total,
  seen,
  visible,
}: {
  /** Messages in the log now. */
  total: number;
  /** Messages present the last time the panel was open. */
  seen: number;
  /** Whether the chat panel is currently showing. */
  visible: boolean;
}): number {
  if (visible) return 0;
  return Math.max(0, total - seen);
}
