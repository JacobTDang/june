export type PlaybackCorrection =
  | { kind: "advance" }
  | { kind: "seek"; toSeconds: number }
  | { kind: "hold" };

export interface CorrectionInput {
  /** Where the shared clock says the track should be (seconds; may be negative). */
  expectedSeconds: number;
  /** Where the local player actually is (seconds). */
  actualSeconds: number;
  durationMs: number;
  /** How far the player may drift before we re-seek it. */
  driftThresholdSeconds: number;
}

/**
 * Decide what a synced player should do to stay on the shared clock.
 *
 * Crucially, when the track is scheduled in the future (`expectedSeconds < 0`)
 * we HOLD rather than seek - seeking toward a negative position clamps to 0 and,
 * every tick, yanks the player back to the start, which is what made a track
 * loop its first second forever.
 */
export function playbackCorrection({
  expectedSeconds,
  actualSeconds,
  durationMs,
  driftThresholdSeconds,
}: CorrectionInput): PlaybackCorrection {
  if (expectedSeconds < 0) return { kind: "hold" };
  if (expectedSeconds * 1000 >= durationMs) return { kind: "advance" };
  if (Math.abs(actualSeconds - expectedSeconds) > driftThresholdSeconds) {
    return { kind: "seek", toSeconds: expectedSeconds };
  }
  return { kind: "hold" };
}

/**
 * Whether the room's shared clock has carried the current track past its own
 * duration.
 *
 * Deliberately independent of any audio element: the room has to move on even
 * when nothing is playing it. Advancement used to ride on the playing
 * device's drift check, which required a started, sourced, unpaused element -
 * so a track that ran out while every listener was paused, silent, or merely
 * looking at the page stayed on screen forever at full elapsed time, and the
 * room could only be freed by someone tapping in.
 */
export function trackHasEnded({
  startedAt,
  durationMs,
  nowMs,
}: {
  startedAt: number | null;
  durationMs: number;
  nowMs: number;
}): boolean {
  // A pending track has no elapsed time yet, and a track of unknown length
  // would read as instantly over - neither is something to skip.
  if (startedAt === null || durationMs <= 0) return false;
  return nowMs - startedAt >= durationMs;
}
