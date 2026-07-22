import { describe, expect, it } from "vitest";
import { searchMusic } from "../../src/discovery/itunes";

/** A fetch stub that records requested URLs and replies per handler. */
function stubFetch(handler: (url: URL) => { status?: number; body: unknown }) {
  const calls: { url: URL }[] = [];
  const fetch = async (url: URL): Promise<Response> => {
    calls.push({ url });
    const { status = 200, body } = handler(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

const track = (over: Record<string, unknown> = {}) => ({
  trackId: 1,
  trackName: "Song",
  artistName: "Artist",
  artworkUrl100: "art",
  trackTimeMillis: 200_000,
  ...over,
});

describe("searchMusic", () => {
  it("builds the iTunes request and normalizes results", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: {
        resultCount: 2,
        results: [
          track({ trackId: 1, trackName: "A", artistName: "X", artworkUrl100: "a1", trackTimeMillis: 60_000 }),
          track({ trackId: 2, trackName: "B", artistName: "Y", artworkUrl100: "a2", trackTimeMillis: 120_000 }),
        ],
      },
    }));

    const results = await searchMusic("daft punk", { limit: 5, fetch });

    expect(results).toEqual([
      { title: "A", artist: "X", artworkUrl: "a1", durationMs: 60_000, source: "itunes", sourceId: "1" },
      { title: "B", artist: "Y", artworkUrl: "a2", durationMs: 120_000, source: "itunes", sourceId: "2" },
    ]);

    const url = calls[0]!.url;
    expect(url.hostname).toBe("itunes.apple.com");
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("term")).toBe("daft punk");
    expect(url.searchParams.get("media")).toBe("music");
    expect(url.searchParams.get("entity")).toBe("song");
    expect(url.searchParams.get("limit")).toBe("5");
  });

  it("defaults the limit to 10", async () => {
    const { fetch, calls } = stubFetch(() => ({ body: { resultCount: 0, results: [] } }));
    await searchMusic("x", { fetch });
    expect(calls[0]!.url.searchParams.get("limit")).toBe("10");
  });

  it("returns an empty array when there are no results", async () => {
    const { fetch } = stubFetch(() => ({ body: { resultCount: 0, results: [] } }));
    expect(await searchMusic("nothing", { fetch })).toEqual([]);
  });

  it("drops results missing a track name or artist", async () => {
    const { fetch } = stubFetch(() => ({
      body: {
        resultCount: 3,
        results: [
          track({ trackId: 1, trackName: "Ok", artistName: "Artist" }),
          track({ trackId: 2, trackName: undefined }),
          track({ trackId: 3, artistName: undefined }),
        ],
      },
    }));
    const results = await searchMusic("x", { fetch });
    expect(results.map((r) => r.sourceId)).toEqual(["1"]);
  });

  it("omits optional fields when absent", async () => {
    const { fetch } = stubFetch(() => ({
      body: {
        resultCount: 1,
        results: [{ trackId: 9, trackName: "Bare", artistName: "Solo" }],
      },
    }));
    const results = await searchMusic("x", { fetch });
    expect(results[0]).toEqual({ title: "Bare", artist: "Solo", source: "itunes", sourceId: "9" });
  });

  it("throws on a non-200 response", async () => {
    const { fetch } = stubFetch(() => ({ status: 503, body: {} }));
    await expect(searchMusic("x", { fetch })).rejects.toThrow(/iTunes Search API 503/);
  });
});
