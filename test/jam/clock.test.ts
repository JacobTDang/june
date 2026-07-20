import { describe, expect, it } from "vitest";
import {
  estimateClockOffset,
  roundTrip,
  sampleOffset,
  type ClockSample,
} from "../../src/jam/clock";

describe("sampleOffset / roundTrip", () => {
  it("recovers a known offset with symmetric latency", () => {
    // Server is 1000ms ahead; round-trip 200ms (100ms each way).
    // sent at client 0 → server responds at client-equivalent 100 → +1000 = 1100.
    const sample: ClockSample = { sentAt: 0, serverTime: 1100, receivedAt: 200 };
    expect(sampleOffset(sample)).toBe(1000);
    expect(roundTrip(sample)).toBe(200);
  });
});

describe("estimateClockOffset", () => {
  it("throws with no samples", () => {
    expect(() => estimateClockOffset([])).toThrow(/at least one sample/);
  });

  it("uses the single sample when only one is given", () => {
    expect(estimateClockOffset([{ sentAt: 0, serverTime: 550, receivedAt: 100 }])).toBe(500);
  });

  it("prefers the sample with the smallest round-trip", () => {
    const samples: ClockSample[] = [
      { sentAt: 0, serverTime: 5000, receivedAt: 900 }, // jittery: rtt 900
      { sentAt: 1000, serverTime: 5010, receivedAt: 1020 }, // clean: rtt 20, offset 5010-1010=4000
      { sentAt: 2000, serverTime: 6200, receivedAt: 2600 }, // rtt 600
    ];
    expect(estimateClockOffset(samples)).toBe(4000);
  });

  it("rounds to whole milliseconds", () => {
    expect(estimateClockOffset([{ sentAt: 0, serverTime: 100, receivedAt: 1 }])).toBe(100);
  });
});
