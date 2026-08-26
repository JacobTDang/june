import { describe, expect, it } from "vitest";
import { friendsPanelState } from "../../src/lib/friends/panel";

describe("friendsPanelState", () => {
  it("shows the list once friends are known to be in a jam", () => {
    expect(friendsPanelState(true, 3)).toBe("list");
  });

  it("shows the empty state once we know there is nobody", () => {
    expect(friendsPanelState(true, 0)).toBe("empty");
  });

  it("does not claim nobody is online before the first load answers", () => {
    // The panel starts with an empty array, so a naive length check reports
    // "no friends online" for the moment before the fetch resolves — the
    // message flashes on every page load and is wrong every time.
    expect(friendsPanelState(false, 0)).toBe("loading");
  });

  it("stays on the list through a refresh that has not answered yet", () => {
    // Polling every 8s must not blink the panel back to a placeholder; once
    // loaded, the panel is only ever list or empty.
    expect(friendsPanelState(true, 1)).toBe("list");
  });
});
