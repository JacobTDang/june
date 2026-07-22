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
 * we HOLD rather than seek — seeking toward a negative position clamps to 0 and,
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
