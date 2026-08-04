import { normalizeQuery } from "../../discovery";

/** Anything with a title and artist can be suggested; this stays structural so
 *  it fits a MusicCandidate without depending on one. */
export interface Suggestable {
  title: string;
  artist: string;
  source: "itunes";
  sourceId: string;
}

/** Roughly "is this the same song" — enough to avoid suggesting what just
 *  played, without pretending to be a matcher. */
function fold(text: string): string {
  return normalizeQuery(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The tracks worth offering a room whose queue has run dry.
 *
 * Two rules, both about not looking stupid: never suggest something the room
 * already heard, and don't stack one artist — three in a row from the same
 * artist reads as a stuck recommender rather than a suggestion.
 */
export function pickSuggestions({
  candidates,
  playedTitles,
  limit,
}: {
  candidates: readonly Suggestable[];
  /** Titles already played in this room, in whatever form they were stored. */
  playedTitles: readonly string[];
  limit: number;
}): Suggestable[] {
  // A played title often carries upload noise ("… (Official Video)"), so both
  // sides are folded before comparing.
  const played = playedTitles.map(fold).filter((t) => t.length > 0);
  const seen = new Set<string>();
  const perArtist = new Map<string, number>();
  const maxPerArtist = Math.max(1, Math.ceil(limit / 2));

  const picked: Suggestable[] = [];
  for (const candidate of candidates) {
    if (picked.length >= limit) break;

    const title = fold(candidate.title);
    if (title === "" || seen.has(title)) continue;
    // A played title may be the longer, noisier string, so check containment
    // in both directions.
    if (played.some((p) => p.includes(title) || title.includes(p))) continue;

    const artist = candidate.artist.trim().toLowerCase();
    if ((perArtist.get(artist) ?? 0) >= maxPerArtist) continue;

    seen.add(title);
    perArtist.set(artist, (perArtist.get(artist) ?? 0) + 1);
    picked.push(candidate);
  }

  return picked;
}
