import { describe, expect, it } from "vitest";
import { clampIndex, renderRoomPicker, type RoomChoice } from "../../src/lib/admin/room-picker";

describe("clampIndex", () => {
  it("moves within the list", () => {
    expect(clampIndex(1, 1, 3)).toBe(2);
    expect(clampIndex(1, -1, 3)).toBe(0);
  });

  it("clamps at the ends instead of wrapping", () => {
    expect(clampIndex(0, -1, 3)).toBe(0);
    expect(clampIndex(2, 1, 3)).toBe(2);
  });

  it("stays at 0 for an empty list", () => {
    expect(clampIndex(0, 1, 0)).toBe(0);
  });
});

describe("renderRoomPicker", () => {
  const rooms: RoomChoice[] = [
    { id: "AAA-BBB", nowPlaying: "idle", here: 0 },
    { id: "CCC-DDD", nowPlaying: "▶ Song — Artist", here: 2 },
  ];

  it("marks only the selected row", () => {
    const lines = renderRoomPicker(rooms, 1).split("\n");
    expect(lines[1]).toContain("❯");
    expect(lines[0]).not.toContain("❯");
  });

  it("lists every room and its people count", () => {
    const out = renderRoomPicker(rooms, 0);
    expect(out).toContain("AAA-BBB");
    expect(out).toContain("CCC-DDD");
    expect(out).toContain("2 here");
  });
});
