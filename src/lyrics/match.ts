/** Turning a room track into something a lyrics provider can find, and
 *  judging what comes back. This is where the feature succeeds or fails:
 *  fetching is trivial, matching is not. */

export interface LyricsCandidate {
  trackName: string;
  artistName: string;
  /** The recording's length, as the provider has it. */
  durationSeconds: number;
  syncedLyrics: string | null;
  plainLyrics: string | null;
}

/**
 * How far a candidate's length may sit from the room's track before it's
 * treated as a different recording. Line timings drift audibly well before
 * this, but a few seconds of intro trimming is normal between uploads.
 */
const MAX_DURATION_DRIFT_SECONDS = 8;

/** Bracketed asides that describe the upload, not the song. */
const VIDEO_FURNITURE =
  /\s*[([](?:[^)\]]*\b(?:official|video|audio|lyrics?|visualizer|remaster(?:ed)?|hd|hq|4k|mv|m\/v|explicit|clean)\b[^)\]]*)[)\]]/gi;

/** Uploader-added credit after the title: "SONG - Artist, Other Artist". */
const TRAILING_CREDIT = /\s+-\s+[^-]+$/;

/**
 * Strip the noise YouTube titles carry, while keeping brackets that belong to
 * the song — "(Mixed)" and "(Live)" name a different recording, so removing
 * them would search for the wrong thing.
 */
export function cleanTitle(raw: string): string {
  const withoutFurniture = raw.replace(VIDEO_FURNITURE, "").trim();
  // Only drop a trailing credit when something is left in front of it.
  const withoutCredit = withoutFurniture.replace(TRAILING_CREDIT, "").trim();
  return withoutCredit.length > 0 ? withoutCredit : withoutFurniture;
}

/** Strip YouTube's auto-generated channel suffixes from an artist name. */
export function cleanArtist(raw: string): string {
  return raw
    .replace(/\s*-\s*Topic\s*$/i, "")
    .replace(/VEVO\s*$/i, "")
    .trim();
}

/**
 * Choose what to show. Synced wins over plain — a follow-along is the point —
 * and among equals the closest duration wins, since a mismatched length means
 * a different cut whose timings would drift against what the room hears.
 * Returns null when nothing is usable.
 */
export function pickBestMatch(
  candidates: readonly LyricsCandidate[],
  target: { durationMs: number },
): LyricsCandidate | null {
  const targetSeconds = target.durationMs / 1000;
  const usable = candidates.filter(
    (c) =>
      (c.syncedLyrics !== null || c.plainLyrics !== null) &&
      // A track of unknown length can't rule anything out.
      (targetSeconds <= 0 ||
        Math.abs(c.durationSeconds - targetSeconds) <= MAX_DURATION_DRIFT_SECONDS),
  );
  if (usable.length === 0) return null;

  const drift = (c: LyricsCandidate) =>
    targetSeconds <= 0 ? 0 : Math.abs(c.durationSeconds - targetSeconds);

  return usable.reduce((best, c) => {
    const bestSynced = best.syncedLyrics !== null;
    const thisSynced = c.syncedLyrics !== null;
    if (thisSynced !== bestSynced) return thisSynced ? c : best;
    return drift(c) < drift(best) ? c : best;
  });
}
