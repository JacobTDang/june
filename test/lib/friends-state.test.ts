import { describe, expect, it } from "vitest";
import { friendState } from "../../src/lib/friends/state";

const me = "me";
const other = "other";

describe("friendState", () => {
  it("is 'none' when there's no row", () => {
    expect(friendState([], me, other)).toBe("none");
  });

  it("is 'friends' when accepted, in either direction", () => {
    expect(friendState([{ requester: me, addressee: other, status: "accepted" }], me, other)).toBe(
      "friends",
    );
    expect(friendState([{ requester: other, addressee: me, status: "accepted" }], me, other)).toBe(
      "friends",
    );
  });

  it("is 'requested' when I sent a pending request", () => {
    expect(friendState([{ requester: me, addressee: other, status: "pending" }], me, other)).toBe(
      "requested",
    );
  });

  it("is 'incoming' when they sent me a pending request", () => {
    expect(friendState([{ requester: other, addressee: me, status: "pending" }], me, other)).toBe(
      "incoming",
    );
  });

  it("ignores rows about other people", () => {
    expect(
      friendState([{ requester: "x", addressee: "y", status: "accepted" }], me, other),
    ).toBe("none");
  });
});
