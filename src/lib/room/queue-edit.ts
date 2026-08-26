/**
 * Editing the queue in the interface before the server has agreed to it.
 *
 * A removal takes effect the moment it's asked for, so for a beat there are two
 * lists: the one on screen and the one the server still has. These are the
 * rules for holding them together — hiding a row whose delete is in flight,
 * dropping that tombstone once the server catches up, and putting the row back
 * exactly where it was when the delete is refused.
 */

type Identified = { id: string };

/** Take a row out, and report where it was so it can go back there. */
export function removeById<T extends Identified>(
  items: readonly T[],
  id: string,
): { next: T[]; removed: T | null; index: number } {
  const index = items.findIndex((item) => item.id === id);
  // Handing back the same array matters: a removal that finds nothing must not
  // look like a change and re-render the queue.
  if (index === -1) return { next: items as T[], removed: null, index: -1 };
  const next = [...items];
  const [removed] = next.splice(index, 1);
  return { next, removed: removed ?? null, index };
}

/** Put a row back at the position it was taken from. */
export function restoreAt<T extends Identified>(items: readonly T[], item: T, index: number): T[] {
  // Realtime may have brought it back first; one copy is enough.
  if (items.some((existing) => existing.id === item.id)) return items as T[];
  const next = [...items];
  next.splice(Math.min(Math.max(index, 0), next.length), 0, item);
  return next;
}

/** The server's queue with the rows we've already removed still hidden. */
export function withoutPending<T extends Identified>(
  items: readonly T[],
  pending: ReadonlySet<string>,
): T[] {
  if (pending.size === 0) return [...items];
  return items.filter((item) => !pending.has(item.id));
}

/** Which pending removals the server has caught up with — their rows are gone
 *  from its list, so the tombstones holding them off screen can be dropped. */
export function confirmedRemovals(
  pending: Iterable<string>,
  serverItems: readonly Identified[],
): string[] {
  const present = new Set(serverItems.map((item) => item.id));
  return [...pending].filter((id) => !present.has(id));
}
