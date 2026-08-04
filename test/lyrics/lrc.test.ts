import { describe, expect, it } from "vitest";
import {
  activeLineIndex,
  lineProgress,
  parseLrc,
  wordSpans,
} from "../../src/lyrics/lrc";

describe("parseLrc", () => {
  it("reads a timestamped line", () => {
    expect(parseLrc("[00:31.52] I'm so tired")).toEqual([{ timeMs: 31_520, text: "I'm so tired" }]);
  });

  it("handles minutes, and centiseconds being optional", () => {
    expect(parseLrc("[01:05]one\n[02:00.7]two")).toEqual([
      { timeMs: 65_000, text: "one" },
      { timeMs: 120_700, text: "two" },
    ]);
  });

  it("expands a line carrying several timestamps, as a repeated chorus does", () => {
    expect(parseLrc("[00:10.00][01:20.00]chorus")).toEqual([
      { timeMs: 10_000, text: "chorus" },
      { timeMs: 80_000, text: "chorus" },
    ]);
  });

  it("keeps empty lines: they're how an LRC marks an instrumental gap", () => {
    // Dropping them would leave the previous line on screen through the break.
    expect(parseLrc("[00:05.00]word\n[00:09.00]")).toEqual([
      { timeMs: 5_000, text: "word" },
      { timeMs: 9_000, text: "" },
    ]);
  });

  it("ignores metadata tags and junk", () => {
    expect(parseLrc("[ar:Portishead]\n[length: 05:10]\nnot a line\n[00:01.00]real")).toEqual([
      { timeMs: 1_000, text: "real" },
    ]);
  });

  it("sorts by time regardless of file order", () => {
    expect(parseLrc("[00:20.00]second\n[00:10.00]first").map((l) => l.text)).toEqual([
      "first",
      "second",
    ]);
  });

  it("returns nothing for empty or unsynced input", () => {
    expect(parseLrc("")).toEqual([]);
    expect(parseLrc("just some plain lyrics\nwith no timing")).toEqual([]);
  });
});

const LINES = parseLrc("[00:10.00]one\n[00:20.00]two\n[00:30.00]three");

describe("activeLineIndex", () => {
  it("is -1 before the first line, so nothing shows during an intro", () => {
    expect(activeLineIndex(LINES, 0)).toBe(-1);
    expect(activeLineIndex(LINES, 9_999)).toBe(-1);
  });

  it("switches exactly on the timestamp", () => {
    expect(activeLineIndex(LINES, 10_000)).toBe(0);
    expect(activeLineIndex(LINES, 19_999)).toBe(0);
    expect(activeLineIndex(LINES, 20_000)).toBe(1);
  });

  it("holds the last line to the end of the track", () => {
    expect(activeLineIndex(LINES, 600_000)).toBe(2);
  });

  it("copes with no lines at all", () => {
    expect(activeLineIndex([], 1_000)).toBe(-1);
  });
});

describe("lineProgress", () => {
  it("runs 0 to 1 across the gap to the next line", () => {
    expect(lineProgress(LINES, 0, 10_000, 60_000)).toBeCloseTo(0);
    expect(lineProgress(LINES, 0, 15_000, 60_000)).toBeCloseTo(0.5);
    expect(lineProgress(LINES, 0, 20_000, 60_000)).toBeCloseTo(1);
  });

  it("uses the track's end for the final line", () => {
    expect(lineProgress(LINES, 2, 40_000, 50_000)).toBeCloseTo(0.5);
  });

  it("clamps rather than running past either end", () => {
    expect(lineProgress(LINES, 0, 0, 60_000)).toBe(0);
    expect(lineProgress(LINES, 0, 999_000, 60_000)).toBe(1);
  });

  it("returns 0 for an index that isn't a line", () => {
    expect(lineProgress(LINES, -1, 5_000, 60_000)).toBe(0);
    expect(lineProgress([], 0, 5_000, 60_000)).toBe(0);
  });
});

describe("wordSpans", () => {
  it("covers the line end to end, in order, without gaps", () => {
    const spans = wordSpans("hey there you");
    expect(spans.map((s) => s.word)).toEqual(["hey", "there", "you"]);
    expect(spans[0]!.start).toBe(0);
    expect(spans[spans.length - 1]!.end).toBe(1);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]!.start).toBeCloseTo(spans[i - 1]!.end);
    }
  });

  it("gives a longer word more of the line's time", () => {
    // Line timings are per-line, so word timing is interpolated by length —
    // an approximation, but one that tracks how a line is actually sung far
    // better than splitting the time evenly.
    const [short, long] = wordSpans("a considerable");
    expect(long!.end - long!.start).toBeGreaterThan(short!.end - short!.start);
  });

  it("ignores extra whitespace", () => {
    expect(wordSpans("  two   words  ").map((s) => s.word)).toEqual(["two", "words"]);
  });

  it("returns nothing for an empty line", () => {
    expect(wordSpans("")).toEqual([]);
    expect(wordSpans("   ")).toEqual([]);
  });
});
