import { describe, expect, it } from "vitest";
import { MAX_BIO, normalizeBio } from "../../src/lib/profile/bio";

describe("normalizeBio", () => {
  it("trims and keeps the text", () => {
    expect(normalizeBio("  makes playlists  ")).toBe("makes playlists");
  });

  it("collapses the whitespace a textarea invites", () => {
    // Otherwise a bio can be padded into a wall of blank lines on a profile.
    expect(normalizeBio("line one\n\n\nline two")).toBe("line one line two");
    expect(normalizeBio("spaced     out")).toBe("spaced out");
  });

  it("treats an empty or whitespace-only bio as none", () => {
    expect(normalizeBio("")).toBeNull();
    expect(normalizeBio("   \n  ")).toBeNull();
  });

  it("accepts a bio at the limit and refuses one past it", () => {
    expect(normalizeBio("x".repeat(MAX_BIO))).toBe("x".repeat(MAX_BIO));
    expect(() => normalizeBio("x".repeat(MAX_BIO + 1))).toThrow(/160 characters or fewer/);
  });

  it("measures after collapsing, so padding can't push it over", () => {
    expect(normalizeBio(`${"x".repeat(MAX_BIO)}      `)).toHaveLength(MAX_BIO);
  });
});
