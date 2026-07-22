import { describe, expect, it } from "vitest";
import { mergeSearchResults } from "../../src/lib/friends/search";

const row = (id: string) => ({ id });

describe("mergeSearchResults", () => {
  it("lists username matches before display-name matches", () => {
    const merged = mergeSearchResults([row("u1"), row("u2")], [row("n1")]);
    expect(merged.map((r) => r.id)).toEqual(["u1", "u2", "n1"]);
  });

  it("dedupes by id, keeping the first (username) occurrence", () => {
    const merged = mergeSearchResults([row("a")], [row("a"), row("b")]);
    expect(merged.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("respects the limit", () => {
    const merged = mergeSearchResults([row("a"), row("b")], [row("c"), row("d")], 3);
    expect(merged.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("handles empty inputs", () => {
    expect(mergeSearchResults([], [])).toEqual([]);
  });
});
