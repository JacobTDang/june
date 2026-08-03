/**
 * How long a room waits for a track download before skipping it. Long enough
 * for a normal yt_dlp run (~5-20s), short enough that a failed job doesn't
 * hold the room hostage for the track's whole duration.
 */
export const PREPARING_TIMEOUT_MS = 90_000;

export function shouldSkipPreparing(preparingSinceMs: number, nowMs: number): boolean {
  return nowMs - preparingSinceMs >= PREPARING_TIMEOUT_MS;
}
