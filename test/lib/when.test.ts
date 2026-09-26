import { describe, expect, it } from "vitest";
import { when } from "../../src/lib/when";

const NOW = Date.parse("2026-09-25T12:00:00Z");

describe("when", () => {
  it("reads coarsely, from just now to days", () => {
    expect(when("2026-09-25T11:59:40Z", NOW)).toBe("just now");
    expect(when("2026-09-25T11:55:00Z", NOW)).toBe("5m ago");
    expect(when("2026-09-25T09:00:00Z", NOW)).toBe("3h ago");
    expect(when("2026-09-24T12:00:00Z", NOW)).toBe("yesterday");
    expect(when("2026-09-22T12:00:00Z", NOW)).toBe("3 days ago");
  });

  it("never reads a future time as negative", () => {
    expect(when("2026-09-25T12:05:00Z", NOW)).toBe("just now");
  });
});
