const ID = "[A-Za-z0-9_-]{11}";
const BARE = new RegExp(`^${ID}$`);
const PATTERNS = [
  new RegExp(`[?&]v=(${ID})`), // watch?v= and music.youtube.com/watch?v=
  new RegExp(`youtu\\.be/(${ID})`),
  new RegExp(`/embed/(${ID})`),
  new RegExp(`/shorts/(${ID})`),
  new RegExp(`/live/(${ID})`),
];

/**
 * Extract an 11-char YouTube video id from a URL (watch, youtu.be, embed,
 * shorts, live, music.youtube) or a bare id. Returns null if none is found.
 */
export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (BARE.test(trimmed)) return trimmed;
  for (const pattern of PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match) return match[1] ?? null;
  }
  return null;
}

/** Playlist ids are longer and less uniform than video ids (PL…, OLAK5uy_…,
 *  UU…, RD…), so this is deliberately loose about shape and strict about
 *  where it will read one from. */
const PLAYLIST_ID = "[A-Za-z0-9_-]{12,}";
const BARE_PLAYLIST = new RegExp(`^${PLAYLIST_ID}$`);
const LIST_PARAM = new RegExp(`[?&]list=(${PLAYLIST_ID})`);

/**
 * Extract a playlist id from a link, or null. A link that also names a video
 * returns null on purpose: YouTube's share menu appends `&list=` to a watch
 * URL, and what the sharer meant was the one track — the caller adds that
 * instead.
 */
export function parsePlaylistId(input: string): string | null {
  const trimmed = input.trim();
  if (parseVideoId(trimmed) !== null) return null;
  if (BARE_PLAYLIST.test(trimmed)) return trimmed;
  return LIST_PARAM.exec(trimmed)?.[1] ?? null;
}

/**
 * Whether an id names one of YouTube's generated mixes (radio). The API can't
 * list their items, so they're refused with an explanation rather than being
 * sent off to fail.
 */
export function isMixPlaylistId(playlistId: string): boolean {
  return playlistId.startsWith("RD");
}
