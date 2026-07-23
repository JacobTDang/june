import { describe, expect, it } from "vitest";
import { clampText } from "../../src/lib/room/track-text";

describe("clampText", () => {
  it("leaves short text untouched (trimmed)", () => {
    expect(clampText("  Blinding Lights  ")).toBe("Blinding Lights");
  });

  it("truncates text longer than the max", () => {
    const long = "x".repeat(500);
    expect(clampText(long, 200)).toHaveLength(200);
  });

  it("defaults the max to 200", () => {
    expect(clampText("y".repeat(300))).toHaveLength(200);
  });

  it("handles an empty string", () => {
    expect(clampText("   ")).toBe("");
  });
});
