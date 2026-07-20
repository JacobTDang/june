import { describe, expect, it } from "vitest";
import {
  getVideoMetas,
  toVideoMeta,
  type CacheDeps,
  type VideoMeta,
} from "../../src/lib/video-cache";
import type { YouTubeVideoItem } from "../../src/youtube/schema";

const meta = (id: string, over: Partial<VideoMeta> = {}): VideoMeta => ({
  videoId: id,
  title: `T${id}`,
  durationMs: 60_000,
  embeddable: true,
  ...over,
});

function fakeDeps(opts: { cached?: VideoMeta[]; fresh?: (ids: string[]) => VideoMeta[] } = {}) {
  const cachedById = new Map((opts.cached ?? []).map((m) => [m.videoId, m]));
  const reads: string[][] = [];
  const writes: VideoMeta[][] = [];
  const fetches: string[][] = [];
  const deps: CacheDeps = {
    async readCache(ids) {
      reads.push(ids);
      return ids
        .map((id) => cachedById.get(id))
        .filter((m): m is VideoMeta => m !== undefined);
    },
    async writeCache(metas) {
      writes.push(metas);
    },
    async fetchFresh(ids) {
      fetches.push(ids);
      return opts.fresh ? opts.fresh(ids) : ids.map((id) => meta(id));
    },
  };
  return { deps, reads, writes, fetches };
}

describe("toVideoMeta", () => {
  it("maps a video item to metadata", () => {
    const item: YouTubeVideoItem = {
      id: "abc",
      snippet: {
        title: "Hey",
        channelTitle: "Band",
        thumbnails: { default: { url: "lo" }, high: { url: "hi" } },
      },
      contentDetails: { duration: "PT4M" },
      status: { embeddable: true },
    };
    expect(toVideoMeta(item)).toEqual({
      videoId: "abc",
      title: "Hey",
      artist: "Band",
      durationMs: 240_000,
      thumbnailUrl: "hi",
      embeddable: true,
    });
  });

  it("defaults embeddable to true and artist to undefined when absent", () => {
    const m = toVideoMeta({
      id: "x",
      snippet: { title: "t" },
      contentDetails: { duration: "PT1M" },
    });
    expect(m.embeddable).toBe(true);
    expect(m.artist).toBeUndefined();
  });

  it("marks non-embeddable videos", () => {
    const m = toVideoMeta({
      id: "x",
      snippet: { title: "t" },
      contentDetails: { duration: "PT1M" },
      status: { embeddable: false },
    });
    expect(m.embeddable).toBe(false);
  });
});

describe("getVideoMetas", () => {
  it("returns nothing and touches no IO for an empty list", async () => {
    const { deps, reads, fetches } = fakeDeps();
    expect(await getVideoMetas([], deps)).toEqual([]);
    expect(reads).toHaveLength(0);
    expect(fetches).toHaveLength(0);
  });

  it("serves fully from cache without fetching", async () => {
    const { deps, fetches, writes } = fakeDeps({ cached: [meta("a"), meta("b")] });
    const result = await getVideoMetas(["a", "b"], deps);
    expect(result.map((m) => m.videoId)).toEqual(["a", "b"]);
    expect(fetches).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  it("fetches and caches only the misses, preserving order", async () => {
    const { deps, fetches, writes } = fakeDeps({ cached: [meta("b")] });
    const result = await getVideoMetas(["a", "b", "c"], deps);
    expect(result.map((m) => m.videoId)).toEqual(["a", "b", "c"]);
    expect(fetches).toEqual([["a", "c"]]); // only the misses
    expect(writes[0]?.map((m) => m.videoId)).toEqual(["a", "c"]);
  });

  it("dedupes ids before reading/fetching", async () => {
    const { deps, reads, fetches } = fakeDeps();
    await getVideoMetas(["a", "a", "b"], deps);
    expect(reads).toEqual([["a", "b"]]);
    expect(fetches).toEqual([["a", "b"]]);
  });

  it("drops ids that resolve to nothing", async () => {
    const { deps } = fakeDeps({ fresh: (ids) => ids.filter((id) => id !== "gone").map((id) => meta(id)) });
    const result = await getVideoMetas(["a", "gone", "b"], deps);
    expect(result.map((m) => m.videoId)).toEqual(["a", "b"]);
  });
});
