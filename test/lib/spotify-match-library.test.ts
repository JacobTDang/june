import { describe, expect, it } from "vitest";
import type { ImportService, ImportStatus, TrackToMatch } from "../../src/audio/imports";
import { matchLibrary, type MatchStore } from "../../src/lib/spotify/match-library";
import type { MatchingSong, PendingSong, SongMatchUpdate } from "../../src/lib/spotify/match-plan";

class FakeStore implements MatchStore {
  pending: PendingSong[] = [];
  /** Songs whose matching failed, and when. */
  failed: { song: PendingSong; matchedAt: Date }[] = [];
  awaiting = new Map<string, MatchingSong[]>();
  marked: { jobId: string; songIds: string[] }[] = [];
  applied: SongMatchUpdate[][] = [];
  log: string[] = [];

  async requeueFailed(olderThan: Date) {
    this.log.push(`requeue(${olderThan.toISOString()})`);
    const due = this.failed.filter((f) => f.matchedAt < olderThan);
    this.failed = this.failed.filter((f) => f.matchedAt >= olderThan);
    this.pending.push(...due.map((f) => f.song));
    return due.length;
  }
  async pendingSongs(limit: number) {
    this.log.push(`pending(${limit})`);
    return this.pending.slice(0, limit);
  }
  async songsAwaitingImports() {
    this.log.push("awaiting");
    return this.awaiting;
  }
  async markMatching(jobId: string, songIds: string[]) {
    this.log.push("mark");
    this.marked.push({ jobId, songIds });
  }
  async applyUpdates(updates: SongMatchUpdate[]) {
    this.log.push("apply");
    this.applied.push(updates);
    // a song sent back to pending is picked up by the same run's new batch
    for (const u of updates) {
      if (u.state === "pending") this.pending.push({ id: u.songId, title: "t", artists: ["a"], durationMs: null });
    }
  }
}

function fakeService(imports: Record<string, ImportStatus | null> = {}) {
  const created: TrackToMatch[][] = [];
  const service: ImportService = {
    async createImport(tracks) {
      created.push(tracks);
      return { id: `job-${created.length}`, total: tracks.length };
    },
    async getImport(id) {
      return imports[id] ?? null;
    },
    async matchOne() {
      throw new Error("not used by matchLibrary");
    },
  };
  return { service, created };
}

const song = (id: string): PendingSong => ({ id, title: `T${id}`, artists: [`A${id}`], durationMs: 1000 });

const NOW = new Date("2026-09-28T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60 * 1000);

describe("matchLibrary", () => {
  it("collects finished imports before submitting new work", async () => {
    const store = new FakeStore();
    store.awaiting.set("job-old", [{ id: "s1", position: 0 }]);
    store.pending = [song("s2")];
    const { service, created } = fakeService({
      "job-old": {
        id: "job-old",
        status: "completed",
        total: 1,
        done: 1,
        tracks: [{ title: "t", artist: "a", state: "resolved", video_id: "v1", confidence: "high", matched_duration_ms: 1000 }],
      },
    });

    const result = await matchLibrary(store, service, NOW);

    expect(store.log).toEqual(["requeue(2026-09-27T12:00:00.000Z)", "awaiting", "apply", "pending(500)", "mark"]);
    expect(store.applied[0]).toEqual([
      { songId: "s1", state: "matched", videoId: "v1", videoDurationMs: 1000, confidence: "high" },
    ]);
    expect(created).toEqual([[{ title: "Ts2", artist: "As2", durationMs: 1000 }]]);
    expect(store.marked).toEqual([{ jobId: "job-1", songIds: ["s2"] }]);
    expect(result).toEqual({ requeued: 0, collected: 1, submitted: 1 });
  });

  it("puts songs that failed over a day ago back in line first, and submits them in the same run", async () => {
    const store = new FakeStore();
    store.failed = [
      { song: song("old"), matchedAt: hoursAgo(25) },
      { song: song("recent"), matchedAt: hoursAgo(1) },
    ];
    const { service, created } = fakeService();

    const result = await matchLibrary(store, service, NOW);

    expect(store.log[0]).toBe("requeue(2026-09-27T12:00:00.000Z)");
    expect(result.requeued).toBe(1);
    expect(created).toEqual([[{ title: "Told", artist: "Aold", durationMs: 1000 }]]);
    expect(store.marked).toEqual([{ jobId: "job-1", songIds: ["old"] }]);
    expect(store.failed.map((f) => f.song.id)).toEqual(["recent"]);
  });

  it("resubmits the songs of an import the server no longer has, in the same run", async () => {
    const store = new FakeStore();
    store.awaiting.set("job-gone", [{ id: "s1", position: 0 }]);
    const { service, created } = fakeService();

    await matchLibrary(store, service, NOW);

    expect(store.applied[0]).toEqual([{ songId: "s1", state: "pending" }]);
    expect(created).toHaveLength(1);
    expect(store.marked[0]?.songIds).toEqual(["s1"]);
  });

  it("submits at most one batch of 500", async () => {
    const store = new FakeStore();
    store.pending = Array.from({ length: 620 }, (_, i) => song(`s${i}`));
    const { service, created } = fakeService();

    const result = await matchLibrary(store, service, NOW);

    expect(created).toHaveLength(1);
    expect(created[0]).toHaveLength(500);
    expect(result.submitted).toBe(500);
  });

  it("submits nothing when nothing is pending", async () => {
    const store = new FakeStore();
    const { service, created } = fakeService();

    expect(await matchLibrary(store, service, NOW)).toEqual({ requeued: 0, collected: 0, submitted: 0 });
    expect(created).toEqual([]);
    expect(store.marked).toEqual([]);
  });

  it("lets a failing import service fail the step", async () => {
    const store = new FakeStore();
    store.pending = [song("s1")];
    const service: ImportService = {
      async createImport() {
        throw new Error("mp3server 503");
      },
      async getImport() {
        return null;
      },
      async matchOne() {
        throw new Error("unused");
      },
    };
    await expect(matchLibrary(store, service, NOW)).rejects.toThrow(/503/);
    expect(store.marked).toEqual([]);
  });
});
