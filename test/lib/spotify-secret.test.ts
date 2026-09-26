import { describe, expect, it } from "vitest";
import { bearerMatches } from "../../src/lib/spotify/secret";

describe("bearerMatches", () => {
  it("accepts exactly `Bearer <secret>`", () => {
    expect(bearerMatches("Bearer s3cret", "s3cret")).toBe(true);
  });

  it("refuses anything else", () => {
    expect(bearerMatches(null, "s3cret")).toBe(false);
    expect(bearerMatches("Bearer wrong!", "s3cret")).toBe(false);
    expect(bearerMatches("s3cret", "s3cret")).toBe(false);
    expect(bearerMatches("Bearer s3cret ", "s3cret")).toBe(false);
  });

  it("refuses to compare against an empty secret", () => {
    expect(() => bearerMatches("Bearer ", "")).toThrow(/secret is empty/);
  });
});
