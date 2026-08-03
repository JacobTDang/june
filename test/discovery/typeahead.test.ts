import { describe, expect, it } from "vitest";
import {
  MIN_AUTO_SEARCH_LENGTH,
  createRequestGate,
  shouldAutoSearch,
} from "../../src/discovery/typeahead";

describe("shouldAutoSearch", () => {
  it("waits for enough characters to be worth a search", () => {
    expect(shouldAutoSearch("x".repeat(MIN_AUTO_SEARCH_LENGTH - 1), false)).toBe(false);
    expect(shouldAutoSearch("x".repeat(MIN_AUTO_SEARCH_LENGTH), false)).toBe(true);
  });

  it("ignores surrounding whitespace when measuring", () => {
    expect(shouldAutoSearch("   a   ", false)).toBe(false);
  });

  it("never searches a pasted link", () => {
    // A link is added directly; searching for its text finds nothing useful.
    expect(shouldAutoSearch("https://youtu.be/dQw4w9WgXcQ", true)).toBe(false);
  });
});

describe("createRequestGate", () => {
  it("accepts the response to the newest request", () => {
    const gate = createRequestGate();
    const token = gate.begin();
    expect(gate.accept(token)).toBe(true);
  });

  it("rejects a slow earlier response once a newer request has started", () => {
    // The bug this exists to prevent: typing "ra" then "radiohead", with the
    // "ra" response arriving last and overwriting the better results.
    const gate = createRequestGate();
    const first = gate.begin();
    const second = gate.begin();

    expect(gate.accept(second)).toBe(true);
    expect(gate.accept(first)).toBe(false);
  });

  it("keeps rejecting a superseded token even if it lands repeatedly", () => {
    const gate = createRequestGate();
    const stale = gate.begin();
    gate.begin();

    expect(gate.accept(stale)).toBe(false);
    expect(gate.accept(stale)).toBe(false);
  });
});
