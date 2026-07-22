export type PlaybackClip = {
  /** Server-clock milliseconds when playback started. */
  startedAt: number;
  durationMs: number;
};

export type Progress = {
  /** Milliseconds elapsed into the clip, clamped to [0, durationMs]. */
  position: number;
  /** Elapsed fraction as a percentage, 0..100. */
  pct: number;
};

/**
 * Where a playing clip currently is, from the client's clock.
 *
 * Pass `now = null` for the pre-mount render: the result is a deterministic
 * zero that doesn't touch the wall clock, so the server render and the client's
 * first hydration render agree (no hydration mismatch). Once the client has
 * mounted it passes a real `Date.now()`, and the live position takes over.
 *
 * @param now    client `Date.now()`, or null before the client has mounted
 * @param offset client→server clock offset (ms) added to `now`
 */
export function playbackProgress(
  now: number | null,
  offset: number,
  clip: PlaybackClip,
): Progress {
  const serverNow = now === null ? clip.startedAt - offset : now;
  const position = Math.min(
    Math.max(0, serverNow + offset - clip.startedAt),
    Math.max(0, clip.durationMs),
  );
  const pct = clip.durationMs > 0 ? (position / clip.durationMs) * 100 : 0;
  return { position, pct };
}
