import { describe, expect, it } from "vitest";
import { unreadCount } from "../../src/lib/room/unread";

describe("unreadCount", () => {
  it("counts what arrived since the panel was last seen", () => {
    expect(unreadCount({ total: 7, seen: 4, visible: false })).toBe(3);
  });

  it("is zero while the panel is open, because you are reading them", () => {
    expect(unreadCount({ total: 7, seen: 4, visible: true })).toBe(0);
  });

  it("is zero when nothing has arrived", () => {
    expect(unreadCount({ total: 4, seen: 4, visible: false })).toBe(0);
  });

  it("never goes negative when the log shrinks", () => {
    // A room can be reset, or a message removed, leaving fewer than were seen.
    // A negative badge is worse than no badge.
    expect(unreadCount({ total: 2, seen: 9, visible: false })).toBe(0);
  });

  it("handles an empty room", () => {
    expect(unreadCount({ total: 0, seen: 0, visible: false })).toBe(0);
  });
});
