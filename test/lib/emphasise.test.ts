import { describe, expect, it } from "vitest";
import { emphasise } from "../../src/lib/typewriter";

const plain = (t: string) => ({ text: t, strong: false });
const bold = (t: string) => ({ text: t, strong: true });

describe("emphasise", () => {
  it("bolds a complete occurrence", () => {
    expect(emphasise("welcome back touse", "touse")).toEqual([
      plain("welcome back "),
      bold("touse"),
    ]);
  });

  it("bolds every occurrence, not just the first", () => {
    expect(emphasise("touse and touse", "touse")).toEqual([
      bold("touse"),
      plain(" and "),
      bold("touse"),
    ]);
  });

  it("bolds a trailing partial so the word does not pop bold on its last letter", () => {
    // The line is typed one character at a time and the term sits at the end
    // of these messages, so without this the word reads plain right up to the
    // final keystroke and then snaps.
    expect(emphasise("why is jacob so tou", "touse")).toEqual([
      plain("why is jacob so "),
      bold("tou"),
    ]);
  });

  it("does not bold a partial that is not at the end", () => {
    // "tou" mid-string is just letters; only the growing edge of the line can
    // be an incomplete term.
    expect(emphasise("tou is a word here", "touse")).toEqual([
      plain("tou is a word here"),
    ]);
  });

  it("leaves text without the term alone", () => {
    expect(emphasise("chris i hope ur having fun", "touse")).toEqual([
      plain("chris i hope ur having fun"),
    ]);
  });

  it("handles the empty line the loop passes through", () => {
    expect(emphasise("", "touse")).toEqual([]);
  });

  it("matches regardless of case but keeps what was written", () => {
    expect(emphasise("Touse", "touse")).toEqual([bold("Touse")]);
  });

  it("does not bold a bare letter that merely starts the term", () => {
    // Every message containing a "t" at the end would otherwise flicker bold
    // for one frame as it types.
    expect(emphasise("t", "touse")).toEqual([plain("t")]);
    expect(emphasise("to", "touse")).toEqual([plain("to")]);
  });
});
