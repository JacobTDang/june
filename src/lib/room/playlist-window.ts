/**
 * Pure helpers for the in-room playlist deck. Import-clean, so they're
 * unit-testable directly.
 */

/** Filter playlists by name (case-insensitive, trimmed substring on `title`). */
export function filterPlaylists<T extends { title: string }>(playlists: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return playlists;
  return playlists.filter((p) => p.title.toLowerCase().includes(q));
}

/** Clamp a focus index into a list's bounds; 0 for an empty list. */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(Math.max(0, Math.floor(index)), length - 1);
}
