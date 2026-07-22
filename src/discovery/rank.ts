import type { MusicCandidate } from "./itunes";

/**
 * Reorder song candidates so the studio version floats to the top: rows whose
 * title carries a "version qualifier" naming karaoke / cover / live / remix /
 * instrumental / etc. are demoted below the plain studio tracks. Nothing is
 * dropped - someone who actually wants the live cut still finds it lower down.
 *
 * A qualifier is text inside parentheses/brackets or after a " - " suffix, e.g.
 * "Song (Live at Wembley)" or "Song - Instrumental". This scoping is what keeps
 * real titles like "Cover Me" or "Live Your Life" ranked as studio tracks.
 *
 * Pure and import-clean so it can be unit-tested directly.
 */

const NOISE_IN_QUALIFIER =
  /\b(?:karaoke|cover|tribute|instrumental|remix|live|sped[\s-]?up|slowed)\b/i;

function qualifierSegments(title: string): string[] {
  const segments: string[] = [];
  for (const m of title.matchAll(/\(([^)]*)\)/g)) segments.push(m[1] ?? "");
  for (const m of title.matchAll(/\[([^\]]*)\]/g)) segments.push(m[1] ?? "");
  const dashSuffix = title.match(/\s-\s+(.+)$/);
  if (dashSuffix) segments.push(dashSuffix[1] ?? "");
  return segments;
}

function isDemoted(title: string): boolean {
  return qualifierSegments(title).some((seg) => NOISE_IN_QUALIFIER.test(seg));
}

export function rankSongResults(candidates: MusicCandidate[]): MusicCandidate[] {
  const studio: MusicCandidate[] = [];
  const demoted: MusicCandidate[] = [];
  for (const c of candidates) (isDemoted(c.title) ? demoted : studio).push(c);
  return [...studio, ...demoted];
}
