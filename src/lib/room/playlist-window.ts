/** Filter playlists by name (case-insensitive, trimmed substring on `title`).
 *  Pure and import-clean, so it's unit-testable directly. */
export function filterPlaylists<T extends { title: string }>(playlists: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return playlists;
  return playlists.filter((p) => p.title.toLowerCase().includes(q));
}
