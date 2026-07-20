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
