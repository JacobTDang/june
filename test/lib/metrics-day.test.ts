import { describe, expect, it } from "vitest";
import { pacificDay } from "../../src/lib/metrics/day";

describe("pacificDay", () => {
  it("returns the Pacific calendar date as YYYY-MM-DD", () => {
    // 2026-07-21 05:00 UTC = 2026-07-20 22:00 PDT
    expect(pacificDay(new Date("2026-07-21T05:00:00Z"))).toBe("2026-07-20");
  });

  it("uses Pacific, not UTC, on the far side of the day boundary", () => {
    // 2026-07-21 12:00 UTC = 2026-07-21 05:00 PDT
    expect(pacificDay(new Date("2026-07-21T12:00:00Z"))).toBe("2026-07-21");
  });

  it("handles winter (PST, UTC-8)", () => {
    // 2026-01-15 06:00 UTC = 2026-01-14 22:00 PST
    expect(pacificDay(new Date("2026-01-15T06:00:00Z"))).toBe("2026-01-14");
  });
});
