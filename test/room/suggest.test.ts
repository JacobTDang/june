import { describe, expect, it } from "vitest";
import { pickSuggestions, type Suggestable } from "../../src/lib/room/suggest";

const song = (title: string, artist = "Portishead"): Suggestable => ({
  title,
  artist,
  source: "itunes",
  sourceId: title,
});

describe("pickSuggestions", () => {
  it("drops anything the room already played", () => {
    // Suggesting the song that just finished is the fastest way to look broken.
    const picked = pickSuggestions({
      candidates: [song("Glory Box"), song("Roads")],
      playedTitles: ["glory box"],
      limit: 3,
    });
    expect(picked.map((s) => s.title)).toEqual(["Roads"]);
  });

  it("matches played titles loosely, since the same song is spelled many ways", () => {
    const picked = pickSuggestions({
      candidates: [song("Glory Box")],
      playedTitles: ["Portishead - Glory Box (Official Video)"],
      limit: 3,
    });
    expect(picked).toEqual([]);
  });

  it("never suggests the same song twice", () => {
    const picked = pickSuggestions({
      candidates: [song("Roads"), song("Roads"), song("Wandering Star")],
      playedTitles: [],
      limit: 3,
    });
    expect(picked).toHaveLength(2);
  });

  it("spreads across artists rather than stacking one", () => {
    // Three tracks by the same artist reads as a stuck recommender.
    const picked = pickSuggestions({
      candidates: [
        song("A", "Portishead"),
        song("B", "Portishead"),
        song("C", "Portishead"),
        song("D", "Mitski"),
      ],
      playedTitles: [],
      limit: 3,
    });
    const artists = picked.map((s) => s.artist);
    expect(new Set(artists).size).toBeGreaterThan(1);
  });

  it("honours the limit and keeps candidate order otherwise", () => {
    const picked = pickSuggestions({
      candidates: [song("A", "X"), song("B", "Y"), song("C", "Z")],
      playedTitles: [],
      limit: 2,
    });
    expect(picked.map((s) => s.title)).toEqual(["A", "B"]);
  });

  it("returns nothing when there is nothing to suggest", () => {
    expect(pickSuggestions({ candidates: [], playedTitles: [], limit: 3 })).toEqual([]);
  });
});
