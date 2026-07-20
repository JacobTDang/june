import { estimateClockOffset, type ClockSample } from "@/src/jam/clock";

/**
 * Sample the server clock a few times and estimate the local→server offset,
 * so playback position can be computed as `Date.now() + offset - startedAt`.
 */
export async function sampleClockOffset(rounds = 5): Promise<number> {
  const samples: ClockSample[] = [];
  for (let i = 0; i < rounds; i++) {
    const sentAt = Date.now();
    const res = await fetch("/api/time", { cache: "no-store" });
    const { now } = (await res.json()) as { now: number };
    samples.push({ sentAt, serverTime: now, receivedAt: Date.now() });
  }
  return estimateClockOffset(samples);
}
