import { describe, expect, it } from "vitest";
import { advanceGuard } from "../../src/lib/room/advance-guard";

describe("advanceGuard", () => {
  it("targets the instance when the room has one", () => {
    expect(
      advanceGuard({ now_playing_instance: "inst-1", now_playing_started_at: 1_000 }),
    ).toEqual({ kind: "instance", instance: "inst-1" });
  });

  it("targets the instance even while the track is still pending", () => {
    // This is the case the old guard could not express: two pending copies of
    // the same video are identical in every other column, so `started_at IS
    // NULL` matched both and a second client could advance past one of them.
    expect(
      advanceGuard({ now_playing_instance: "inst-2", now_playing_started_at: null }),
    ).toEqual({ kind: "instance", instance: "inst-2" });
  });

  it("falls back to the old guard for a track promoted before instances existed", () => {
    // A room mid-song when this shipped has no instance; it must still be
    // advanceable rather than stuck.
    expect(
      advanceGuard({ now_playing_instance: null, now_playing_started_at: 1_700 }),
    ).toEqual({ kind: "legacy", startedAt: 1_700 });

    expect(
      advanceGuard({ now_playing_instance: null, now_playing_started_at: null }),
    ).toEqual({ kind: "legacy", startedAt: null });
  });
});
