import { describe, expect, it } from "vitest";
import { captionsToLines, type Cue } from "../../src/lyrics/captions";

const cue = (startMs: number, text: string): Cue => ({ startMs, text });

describe("captionsToLines", () => {
  it("keeps sung lines and their exact times", () => {
    expect(
      captionsToLines([cue(16_460, "♪ I'm so tired of playing ♪"), cue(20_920, "♪ Playing with this bow ♪")]),
    ).toEqual([
      { timeMs: 16_460, text: "I'm so tired of playing" },
      { timeMs: 20_920, text: "Playing with this bow" },
    ]);
  });

  it("drops the sound descriptions captions carry", () => {
    // A caption track narrates the recording, not just the singing; showing
    // "(gentle music)" as a lyric is how you tell nobody read the output.
    expect(
      captionsToLines([
        cue(1_000, "(gentle music)"),
        cue(2_000, "[Music]"),
        cue(3_000, "♪♪"),
        cue(16_000, "real words"),
      ]),
    ).toEqual([{ timeMs: 16_000, text: "real words" }]);
  });

  it("flattens a cue that spans two lines", () => {
    expect(captionsToLines([cue(1_000, "first half\nsecond half")])).toEqual([
      { timeMs: 1_000, text: "first half second half" },
    ]);
  });

  it("collapses a repeated cue, which is how rolling captions arrive", () => {
    // Auto-captions re-emit a line as it builds; without this the same words
    // would re-trigger every couple of hundred milliseconds.
    expect(
      captionsToLines([cue(1_000, "hold on"), cue(1_300, "hold on"), cue(4_000, "let go")]),
    ).toEqual([
      { timeMs: 1_000, text: "hold on" },
      { timeMs: 4_000, text: "let go" },
    ]);
  });

  it("sorts by time and ignores empties", () => {
    expect(captionsToLines([cue(5_000, "later"), cue(1_000, ""), cue(2_000, "earlier")])).toEqual([
      { timeMs: 2_000, text: "earlier" },
      { timeMs: 5_000, text: "later" },
    ]);
  });

  it("returns nothing when a video has no captions", () => {
    expect(captionsToLines([])).toEqual([]);
  });

  it("refuses a track that is all narration, so the caller falls back", () => {
    expect(captionsToLines([cue(1_000, "[Music]"), cue(90_000, "(applause)")])).toEqual([]);
  });
});
