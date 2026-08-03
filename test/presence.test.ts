import { describe, expect, it } from "vitest";
import { visibleParticipants } from "../src/lib/room/presence";
import type { RoomParticipant } from "../src/lib/room/types";

const alice: RoomParticipant = { userId: "alice", name: "Alice", avatarUrl: null };
const bob: RoomParticipant = { userId: "bob", name: "Bob", avatarUrl: null };
const cara: RoomParticipant = { userId: "cara", name: "Cara", avatarUrl: null };

const members = [alice, bob, cara];

describe("visibleParticipants", () => {
  it("shows the full membership while presence is unavailable", () => {
    expect(visibleParticipants(members, null, "alice")).toEqual(members);
  });

  it("shows only members who are present on the channel", () => {
    expect(visibleParticipants(members, new Set(["alice", "cara"]), "alice")).toEqual([
      alice,
      cara,
    ]);
  });

  it("always shows the viewer, even before their own presence syncs", () => {
    expect(visibleParticipants(members, new Set(["bob"]), "alice")).toEqual([alice, bob]);
  });

  it("shows only the viewer when nobody else is present", () => {
    expect(visibleParticipants(members, new Set(), "alice")).toEqual([alice]);
  });

  it("ignores presence entries that are not members", () => {
    expect(visibleParticipants(members, new Set(["alice", "stranger"]), "alice")).toEqual([
      alice,
    ]);
  });
});
