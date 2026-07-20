/**
 * Clock synchronization. Every client derives playback position from
 * `nowPlaying.startedAt`, which is on the *server's* clock — but each client's
 * local clock drifts from it by seconds. These helpers estimate that offset
 * (NTP-style) so a client can compute `serverNow = Date.now() + offset`.
 */

export interface ClockSample {
  /** Client time (ms) when the request was sent. */
  sentAt: number;
  /** Server time (ms) reported in the response. */
  serverTime: number;
  /** Client time (ms) when the response was received. */
  receivedAt: number;
}

/** Server-minus-client offset implied by one round trip. */
export function sampleOffset(sample: ClockSample): number {
  return sample.serverTime - (sample.sentAt + sample.receivedAt) / 2;
}

/** Round-trip time of a sample. */
export function roundTrip(sample: ClockSample): number {
  return sample.receivedAt - sample.sentAt;
}

/**
 * Estimate the client→server clock offset from several round trips, using the
 * sample with the smallest round-trip (least network jitter → most accurate).
 * Then `serverNow = Date.now() + estimateClockOffset(samples)`.
 */
export function estimateClockOffset(samples: ClockSample[]): number {
  const first = samples[0];
  if (first === undefined) {
    throw new Error("estimateClockOffset: need at least one sample");
  }
  let best = first;
  for (const sample of samples) {
    if (roundTrip(sample) < roundTrip(best)) best = sample;
  }
  return Math.round(sampleOffset(best));
}
