import { describe, expect, it } from "vitest";
import { filterPlaylists, clampIndex } from "../../src/lib/room/playlist-window";

const pl = (title: string) => ({ id: title, title, itemCount: 0 });
const list = [pl("Chill"), pl("Workout"), pl("Focus"), pl("Party"), pl("Chill Vibes")];

describe("filterPlaylists", () => {
  it("returns everything for an empty query", () => {
    expect(filterPlaylists(list, "").map((p) => p.title)).toEqual([
      "Chill",
      "Workout",
      "Focus",
      "Party",
      "Chill Vibes",
    ]);
  });

  it("filters by title, case-insensitively", () => {
    expect(filterPlaylists(list, "chill").map((p) => p.title)).toEqual(["Chill", "Chill Vibes"]);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(filterPlaylists(list, "  focus  ").map((p) => p.title)).toEqual(["Focus"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterPlaylists(list, "zzz")).toEqual([]);
  });
});

describe("clampIndex", () => {
  it("keeps an in-range index unchanged", () => {
    expect(clampIndex(2, 5)).toBe(2);
  });

  it("clamps a negative index to zero", () => {
    expect(clampIndex(-3, 5)).toBe(0);
  });

  it("clamps an index past the end to the last item", () => {
    expect(clampIndex(9, 5)).toBe(4);
  });

  it("returns zero for an empty list", () => {
    expect(clampIndex(3, 0)).toBe(0);
  });
});
