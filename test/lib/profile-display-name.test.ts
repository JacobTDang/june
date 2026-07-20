import { describe, expect, it } from "vitest";
import { normalizeDisplayName, resolveDisplayName } from "../../src/lib/profile/display-name";

describe("resolveDisplayName", () => {
  const user = { email: "a@b.com", user_metadata: { full_name: "Google Name", name: "nick" } };

  it("prefers the chosen profile name", () => {
    expect(resolveDisplayName("  Uso  ", user)).toBe("Uso");
  });

  it("falls back to the Google full name when no profile name", () => {
    expect(resolveDisplayName(null, user)).toBe("Google Name");
    expect(resolveDisplayName("   ", user)).toBe("Google Name");
  });

  it("falls back to name, then email, then Guest", () => {
    expect(resolveDisplayName(null, { email: "x@y.com", user_metadata: { name: "nick" } })).toBe(
      "nick",
    );
    expect(resolveDisplayName(null, { email: "x@y.com", user_metadata: {} })).toBe("x@y.com");
    expect(resolveDisplayName(null, {})).toBe("Guest");
  });
});

describe("normalizeDisplayName", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalizeDisplayName("  Jacob   Dang ")).toBe("Jacob Dang");
  });

  it("rejects empty / whitespace-only names", () => {
    expect(() => normalizeDisplayName("   ")).toThrow(/empty/i);
    expect(() => normalizeDisplayName("")).toThrow(/empty/i);
  });

  it("rejects names longer than the limit", () => {
    expect(() => normalizeDisplayName("x".repeat(41))).toThrow(/40 characters/i);
  });

  it("accepts a valid name", () => {
    expect(normalizeDisplayName("DJ 🎧")).toBe("DJ 🎧");
  });
});
