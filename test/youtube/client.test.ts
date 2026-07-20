import { describe, expect, it } from "vitest";
import {
  createYouTubeClient,
  searchTracks,
  type YouTubeClient,
} from "../../src/youtube/client";
import type { YouTubeVideoItem } from "../../src/youtube/schema";

function videoItem(id: string): YouTubeVideoItem {
  return {
    id,
    snippet: { title: `T${id}`, channelTitle: "C" },
    contentDetails: { duration: "PT1M" },
    status: { embeddable: true },
  };
}

/** A fetch stub that records requested URLs and replies per handler. */
function stubFetch(handler: (url: URL) => { status?: number; body: unknown }) {
  const calls: URL[] = [];
  const fetch = async (url: URL): Promise<Response> => {
    calls.push(url);
    const { status = 200, body } = handler(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

describe("createYouTubeClient", () => {
  it("requires an api key", () => {
    expect(() => createYouTubeClient({ apiKey: "" })).toThrow(/apiKey is required/);
  });

  describe("searchVideoIds", () => {
    it("builds the search request and returns ids in order", async () => {
      const { fetch, calls } = stubFetch(() => ({
        body: { items: [{ id: { videoId: "a" } }, { id: { videoId: "b" } }] },
      }));
      const client = createYouTubeClient({ apiKey: "KEY", fetch });

      const ids = await client.searchVideoIds("lofi beats", { maxResults: 10 });

      expect(ids).toEqual(["a", "b"]);
      const url = calls[0]!;
      expect(url.pathname).toMatch(/\/search$/);
      expect(url.searchParams.get("q")).toBe("lofi beats");
      expect(url.searchParams.get("type")).toBe("video");
      expect(url.searchParams.get("maxResults")).toBe("10");
      expect(url.searchParams.get("key")).toBe("KEY");
    });

    it("ignores results that are not videos", async () => {
      const { fetch } = stubFetch(() => ({
        body: { items: [{ id: { videoId: "a" } }, { id: { channelId: "c" } }] },
      }));
      const client = createYouTubeClient({ apiKey: "K", fetch });
      expect(await client.searchVideoIds("x")).toEqual(["a"]);
    });
  });

  describe("getVideos", () => {
    it("fetches details, preserving order and dropping missing ids", async () => {
      const { fetch, calls } = stubFetch((url) => {
        const ids = url.searchParams.get("id")!.split(",");
        // Reverse the order and omit "c" to simulate an unavailable video.
        const items = ids.filter((id) => id !== "c").reverse().map(videoItem);
        return { body: { items } };
      });
      const client = createYouTubeClient({ apiKey: "K", fetch });

      const videos = await client.getVideos(["a", "b", "c"]);

      expect(videos.map((v) => v.id)).toEqual(["a", "b"]);
      expect(calls[0]!.searchParams.get("part")).toBe("snippet,contentDetails,status");
    });

    it("does not call the network for an empty id list", async () => {
      const { fetch, calls } = stubFetch(() => ({ body: { items: [] } }));
      const client = createYouTubeClient({ apiKey: "K", fetch });
      expect(await client.getVideos([])).toEqual([]);
      expect(calls).toHaveLength(0);
    });

    it("dedupes ids before requesting", async () => {
      const { fetch, calls } = stubFetch((url) => {
        const ids = url.searchParams.get("id")!.split(",");
        return { body: { items: ids.map(videoItem) } };
      });
      const client = createYouTubeClient({ apiKey: "K", fetch });

      const videos = await client.getVideos(["a", "a", "b"]);

      expect(calls[0]!.searchParams.get("id")).toBe("a,b");
      expect(videos.map((v) => v.id)).toEqual(["a", "b"]);
    });

    it("splits more than 50 ids across requests, preserving order", async () => {
      const { fetch, calls } = stubFetch((url) => {
        const ids = url.searchParams.get("id")!.split(",");
        return { body: { items: ids.map(videoItem) } };
      });
      const client = createYouTubeClient({ apiKey: "K", fetch });

      const ids = Array.from({ length: 120 }, (_, i) => `v${i}`);
      const videos = await client.getVideos(ids);

      expect(calls).toHaveLength(3); // 50 + 50 + 20
      expect(videos.map((v) => v.id)).toEqual(ids);
    });
  });

  it("throws with the status and message on an API error", async () => {
    const { fetch } = stubFetch(() => ({
      status: 403,
      body: { error: { message: "You have exceeded your quota." } },
    }));
    const client = createYouTubeClient({ apiKey: "K", fetch });
    await expect(client.searchVideoIds("x")).rejects.toThrow(/YouTube API 403: .*quota/);
  });
});

describe("searchTracks", () => {
  it("composes search and details into tracks, reporting skips", async () => {
    const fakeClient: YouTubeClient = {
      searchVideoIds: async () => ["a", "b"],
      getVideos: async () => [
        videoItem("a"),
        { ...videoItem("b"), status: { embeddable: false } },
      ],
    };
    let n = 0;

    const { tracks, skipped } = await searchTracks(fakeClient, "q", "alice", {
      makeId: () => `id-${++n}`,
    });

    expect(tracks.map((t) => [t.id, t.videoId])).toEqual([["id-1", "a"]]);
    expect(skipped).toEqual([{ videoId: "b", title: "Tb", reason: "not-embeddable" }]);
  });
});
