/** A per-track, per-device correction for lyrics that sit slightly ahead of
 *  or behind the recording.
 *
 *  Even a correctly matched file drifts when the upload isn't the reference
 *  recording — a longer intro, a trimmed count-in, a slightly different
 *  master. No amount of matching fixes that, so the listener gets a nudge. */

/** One press. Half a second is about the smallest shift that reads as a fix. */
export const NUDGE_STEP_MS = 500;

/** Beyond a few seconds the file is the wrong recording, and nudging is the
 *  wrong cure — so the control stops there rather than letting someone drag
 *  the lyrics into an unrelated part of the song. */
const NUDGE_LIMIT_MS = 10_000;

export function clampNudge(ms: number): number {
  return Math.min(NUDGE_LIMIT_MS, Math.max(-NUDGE_LIMIT_MS, ms));
}

/** Stored per videoId: a correction for one upload says nothing about another. */
export function nudgeKey(videoId: string): string {
  return `june:lyric-nudge:${videoId}`;
}

export function readNudge(raw: string | null): number {
  const value = Number(raw);
  if (raw === null || raw.trim() === "" || !Number.isFinite(value)) return 0;
  return clampNudge(value);
}
