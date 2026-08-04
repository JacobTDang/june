import { describe, expect, it } from "vitest";
import {
  activeLineIndex,
  parseLrc,
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

  it("applies the file's offset tag to every timestamp", () => {
    // Transcribers use [offset:] to correct a file that runs early or late
    // against the recording; ignoring it leaves those files permanently out.
    expect(parseLrc("[offset:+500]\n[00:10.00]x")).toEqual([{ timeMs: 10_500, text: "x" }]);
    expect(parseLrc("[offset:-750]\n[00:10.00]x")).toEqual([{ timeMs: 9_250, text: "x" }]);
    expect(parseLrc("[offset: 250 ]\n[00:10.00]x")).toEqual([{ timeMs: 10_250, text: "x" }]);
  });

  it("never lets an offset push a line before the start of the track", () => {
    expect(parseLrc("[offset:-5000]\n[00:01.00]x")).toEqual([{ timeMs: 0, text: "x" }]);
  });

  it("ignores an offset tag that isn't a number", () => {
    expect(parseLrc("[offset:soon]\n[00:10.00]x")).toEqual([{ timeMs: 10_000, text: "x" }]);
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

