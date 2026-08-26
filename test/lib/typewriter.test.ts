import { describe, expect, it } from "vitest";
import { typewriterFrame, type TypewriterTiming } from "../../src/lib/typewriter";

const T: TypewriterTiming = { typeMs: 100, holdMs: 1000, deleteMs: 50, gapMs: 200 };
const MSGS = ["ab", "cd"];
// "ab": type 2×100=200, hold 1000, delete 2×50=100, gap 200 → 1500 per message.
const CYCLE = 1500;

describe("typewriterFrame", () => {
  it("shows nothing at the very start", () => {
    expect(typewriterFrame(MSGS, 0, T).text).toBe("");
  });

  it("reveals one character at a time", () => {
    expect(typewriterFrame(MSGS, 120, T).text).toBe("a");
    expect(typewriterFrame(MSGS, 220, T).text).toBe("ab");
  });

  it("holds the whole message before deleting", () => {
    expect(typewriterFrame(MSGS, 700, T).text).toBe("ab");
    expect(typewriterFrame(MSGS, 1150, T).text).toBe("ab");
  });

  it("removes one character at a time", () => {
    expect(typewriterFrame(MSGS, 1250, T).text).toBe("a");
    expect(typewriterFrame(MSGS, 1310, T).text).toBe("");
  });

  it("moves to the next message after the gap", () => {
    const frame = typewriterFrame(MSGS, CYCLE + 120, T);
    expect(frame.text).toBe("c");
    expect(frame.index).toBe(1);
  });

  it("wraps back to the first message", () => {
    // Two messages, so the third cycle is the first message again — the loop
    // has to be endless without growing an index forever.
    const frame = typewriterFrame(MSGS, CYCLE * 2 + 120, T);
    expect(frame.text).toBe("a");
    expect(frame.index).toBe(0);
  });

  it("never returns more characters than the message holds", () => {
    // Rounding at the boundary is the easy bug here: one frame of "abx" or an
    // undefined character would render as a flicker nobody can reproduce.
    for (let t = 0; t < CYCLE * 2; t += 7) {
      const { text, index } = typewriterFrame(MSGS, t, T);
      expect(MSGS[index]!.startsWith(text)).toBe(true);
    }
  });

  it("is safe with no messages at all", () => {
    expect(typewriterFrame([], 500, T)).toEqual({ text: "", index: 0 });
  });

  it("handles messages of different lengths independently", () => {
    // Each message's cycle is its own length, so a long one must not shorten
    // the next or the sequence drifts out of step with itself.
    const mixed = ["a", "abcd"];
    const first = 1 * T.typeMs + T.holdMs + 1 * T.deleteMs + T.gapMs;
    expect(typewriterFrame(mixed, first + 120, T)).toEqual({ text: "a", index: 1 });
  });
});
