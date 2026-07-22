import type { ArtistCandidate } from "./itunes";

/**
 * Decide whether a search query is really an artist search, and if so which
 * artist to surface as a chip. Deliberately conservative: a chip only appears
 * when the query names the artist strongly, so ordinary song searches don't
 * sprout an irrelevant chip.
 *
 * A match is either an exact (folded) name equality, or the query being the
 * *leading tokens* of the artist's name ("kendrick" → "Kendrick Lamar"). A
 * suffix or interior fragment ("punk" → "Daft Punk") does not match, nor does a
 * partial token ("dr" → "Drake"). Exact matches win over prefix matches so a
 * tribute act ranked above the real artist can't hijack the chip.
 *
 * Pure and import-clean so it can be unit-tested directly.
 */

/** Fold a name for comparison: strip diacritics/punctuation, lowercase, drop a leading "the". */
function foldForMatch(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the\s+/, "")
    .trim();
}

export function pickArtistMatch(
  query: string,
  artists: ArtistCandidate[],
): ArtistCandidate | null {
  const q = foldForMatch(query);
  if (!q) return null;
  const qTokens = q.split(" ");

  // Exact folded-name equality wins outright.
  for (const a of artists) {
    if (foldForMatch(a.name) === q) return a;
  }

  // Otherwise the query must be the leading tokens of the artist's name.
  for (const a of artists) {
    const nTokens = foldForMatch(a.name).split(" ").filter(Boolean);
    if (qTokens.length <= nTokens.length && qTokens.every((t, i) => t === nTokens[i])) {
      return a;
    }
  }

  return null;
}
