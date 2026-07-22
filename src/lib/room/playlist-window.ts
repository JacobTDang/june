/**
 * Filter playlists by name and slice them into a fixed-size page window, for the
 * in-room playlist carousel. Pure and import-clean so it's unit-testable.
 *
 * - Filters case-insensitively on `title` (trimmed substring).
 * - `pageCount` is at least 1 even when nothing matches.
 * - `page` is clamped into range, so callers can pass a raw counter freely.
 */
export interface PlaylistWindowResult<T> {
  cards: T[];
  page: number;
  pageCount: number;
  total: number;
}

export function playlistWindow<T extends { title: string }>(
  playlists: T[],
  query: string,
  page: number,
  size = 3,
): PlaylistWindowResult<T> {
  const q = query.trim().toLowerCase();
  const filtered = q ? playlists.filter((p) => p.title.toLowerCase().includes(q)) : playlists;

  const pageCount = Math.max(1, Math.ceil(filtered.length / size));
  const clamped = Math.min(Math.max(0, Math.floor(page)), pageCount - 1);
  const start = clamped * size;

  return {
    cards: filtered.slice(start, start + size),
    page: clamped,
    pageCount,
    total: filtered.length,
  };
}
