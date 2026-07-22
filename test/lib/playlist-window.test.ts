import { describe, expect, it } from "vitest";
import { playlistWindow } from "../../src/lib/room/playlist-window";

const pl = (title: string) => ({ id: title, title, itemCount: 0 });
const list = [pl("Chill"), pl("Workout"), pl("Focus"), pl("Party"), pl("Chill Vibes")];

describe("playlistWindow", () => {
  it("returns the first page window and a correct page count", () => {
    const r = playlistWindow(list, "", 0, 3);
    expect(r.cards.map((c) => c.title)).toEqual(["Chill", "Workout", "Focus"]);
    expect(r.pageCount).toBe(2);
    expect(r.total).toBe(5);
    expect(r.page).toBe(0);
  });

  it("returns the second (partial) page", () => {
    const r = playlistWindow(list, "", 1, 3);
    expect(r.cards.map((c) => c.title)).toEqual(["Party", "Chill Vibes"]);
    expect(r.page).toBe(1);
  });

  it("filters by name, case-insensitively", () => {
    const r = playlistWindow(list, "chill", 0, 3);
    expect(r.cards.map((c) => c.title)).toEqual(["Chill", "Chill Vibes"]);
    expect(r.total).toBe(2);
    expect(r.pageCount).toBe(1);
  });

  it("clamps a page past the end to the last page", () => {
    const r = playlistWindow(list, "", 9, 3);
    expect(r.page).toBe(1);
    expect(r.cards.map((c) => c.title)).toEqual(["Party", "Chill Vibes"]);
  });

  it("clamps a negative page to zero", () => {
    expect(playlistWindow(list, "", -3, 3).page).toBe(0);
  });

  it("handles no matches: one empty page", () => {
    const r = playlistWindow(list, "zzz", 0, 3);
    expect(r.cards).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.pageCount).toBe(1);
    expect(r.page).toBe(0);
  });

  it("ignores surrounding whitespace in the query", () => {
    expect(playlistWindow(list, "  focus  ", 0, 3).cards.map((c) => c.title)).toEqual(["Focus"]);
  });
});
