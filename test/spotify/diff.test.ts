import { describe, expect, it } from "vitest";
import {
  advanceCursor,
  dailyPassDue,
  freshLikes,
  likesToRemove,
  planPlaylists,
  recentGap,
  syncNowAllowed,
  tokenNeedsRefresh,
} from "../../src/spotify/diff";
import type { PlaylistSummary } from "../../src/spotify/schema";

const like = (added_at: string) => ({ added_at });

describe("freshLikes", () => {
  it("takes everything when nothing is stored yet", () => {
    const items = [like("2026-09-22T00:00:00Z"), like("2026-09-10T00:00:00Z")];
    expect(freshLikes(items, null)).toEqual({ fresh: items, done: false });
  });

  it("stops at the first like older than the newest stored", () => {
    const items = [
      like("2026-09-22T00:00:00Z"),
      like("2026-09-20T00:00:00Z"),
      like("2026-09-10T00:00:00Z"),
    ];
    expect(freshLikes(items, "2026-09-20T00:00:00Z")).toEqual({
      fresh: [items[0], items[1]],
      done: true,
    });
  });

  it("keeps going when the whole page is newer", () => {
    const items = [like("2026-09-22T00:00:00Z")];
    expect(freshLikes(items, "2026-09-01T00:00:00Z")).toEqual({ fresh: items, done: false });
  });
});

describe("likesToRemove", () => {
  it("lists stored likes the full pass didn't see", () => {
    expect(likesToRemove(["a", "b", "c"], new Set(["a", "c"]))).toEqual(["b"]);
  });
});

function playlist(id: string, owner: string, snapshot: string, collaborative = false): PlaylistSummary {
  return { id, name: id, collaborative, owner: { id: owner }, snapshot_id: snapshot };
}

describe("planPlaylists", () => {
  it("keeps owned and collaborative playlists and ignores followed ones", () => {
    const remote = [
      playlist("mine", "me", "s1"),
      playlist("collab", "friend", "s1", true),
      playlist("followed", "friend", "s1"),
    ];
    const plan = planPlaylists(remote, [], "me");
    expect(plan.mine.map((p) => p.id)).toEqual(["mine", "collab"]);
    expect(plan.refresh.map((p) => p.id)).toEqual(["mine", "collab"]);
    expect(plan.remove).toEqual([]);
  });

  it("re-reads only playlists whose snapshot changed, or never finished", () => {
    const remote = [
      playlist("same", "me", "s1"),
      playlist("changed", "me", "s2"),
      playlist("unfinished", "me", "s1"),
    ];
    const stored = [
      { sourceId: "same", snapshotId: "s1" },
      { sourceId: "changed", snapshotId: "s1" },
      { sourceId: "unfinished", snapshotId: null },
    ];
    expect(planPlaylists(remote, stored, "me").refresh.map((p) => p.id)).toEqual([
      "changed",
      "unfinished",
    ]);
  });

  it("removes stored playlists that are gone or no longer yours", () => {
    const remote = [playlist("kept", "me", "s1"), playlist("given-away", "friend", "s1")];
    const stored = [
      { sourceId: "kept", snapshotId: "s1" },
      { sourceId: "deleted", snapshotId: "s1" },
      { sourceId: "given-away", snapshotId: "s1" },
    ];
    expect(planPlaylists(remote, stored, "me").remove).toEqual(["deleted", "given-away"]);
  });
});

describe("advanceCursor", () => {
  it("moves to the newest play", () => {
    expect(
      advanceCursor(["2026-09-25T10:00:00.000Z", "2026-09-25T11:00:00.000Z"], null),
    ).toBe("2026-09-25T11:00:00.000Z");
  });

  it("never moves backwards, and stays put with no plays", () => {
    expect(advanceCursor(["2026-09-25T09:00:00.000Z"], "2026-09-25T10:00:00.000Z")).toBe(
      "2026-09-25T10:00:00.000Z",
    );
    expect(advanceCursor([], "2026-09-25T10:00:00.000Z")).toBe("2026-09-25T10:00:00.000Z");
    expect(advanceCursor([], null)).toBeNull();
  });
});

describe("recentGap", () => {
  const minutes = (n: number) => new Date(Date.parse("2026-09-25T10:00:00.000Z") + n * 60_000).toISOString();
  const fullPage = Array.from({ length: 50 }, (_, i) => minutes(10 + i));

  it("flags a full page that is all newer than the cursor", () => {
    expect(recentGap(fullPage, minutes(0))).toEqual({ from: minutes(0), to: minutes(10) });
  });

  it("is quiet for a short page, a first sync, or a page reaching the cursor", () => {
    expect(recentGap(fullPage.slice(0, 49), minutes(0))).toBeNull();
    expect(recentGap(fullPage, null)).toBeNull();
    expect(recentGap(fullPage, minutes(10))).toBeNull();
  });
});

describe("timing", () => {
  const now = new Date("2026-09-25T12:00:00Z");

  it("refreshes a token with a minute or less left, or none known", () => {
    expect(tokenNeedsRefresh("2026-09-25T12:00:30Z", now)).toBe(true);
    expect(tokenNeedsRefresh("2026-09-25T12:01:00Z", now)).toBe(true);
    expect(tokenNeedsRefresh("2026-09-25T12:05:00Z", now)).toBe(false);
    expect(tokenNeedsRefresh(null, now)).toBe(true);
  });

  it("runs the daily pass after 24 hours, or if it never ran", () => {
    expect(dailyPassDue(null, now)).toBe(true);
    expect(dailyPassDue("2026-09-24T12:00:00Z", now)).toBe(true);
    expect(dailyPassDue("2026-09-24T12:00:01Z", now)).toBe(false);
  });

  it("allows Sync now once a minute", () => {
    expect(syncNowAllowed(null, now)).toBe(true);
    expect(syncNowAllowed("2026-09-25T11:59:00Z", now)).toBe(true);
    expect(syncNowAllowed("2026-09-25T11:59:30Z", now)).toBe(false);
  });
});
