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

  it("defaults the limit to 15", async () => {
    const { fetch, calls } = stubFetch(() => ({ body: { resultCount: 0, results: [] } }));
    await searchMusic("x", { fetch });
    expect(calls[0]!.url.searchParams.get("limit")).toBe("15");
  });

  it("sends the normalized term and ranks studio versions above noise", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: {
        resultCount: 3,
        results: [
          track({ trackId: 1, trackName: "Song (Karaoke Version)", artistName: "X" }),
          track({ trackId: 2, trackName: "Song", artistName: "X" }),
          track({ trackId: 3, trackName: "Other", artistName: "Y" }),
        ],
      },
    }));

    const results = await searchMusic("Song official video", { fetch });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.searchParams.get("term")).toBe("Song");
    expect(results.map((r) => r.sourceId)).toEqual(["2", "3", "1"]);
  });

  it("retries with the raw query when the normalized search is sparse", async () => {
    const { fetch, calls } = stubFetch((url) => {
      if (url.searchParams.get("term") === "Halo") {
        return { body: { resultCount: 1, results: [track({ trackId: 1, trackName: "Halo" })] } };
      }
      return {
        body: {
          resultCount: 3,
          results: [
            track({ trackId: 1, trackName: "Halo" }),
            track({ trackId: 2, trackName: "Halo (Live at Wembley)" }),
            track({ trackId: 3, trackName: "Halo (Karaoke)" }),
          ],
        },
      };
    });

    const results = await searchMusic("Halo lyrics", { fetch });

    expect(calls).toHaveLength(2);
    expect(calls[0]!.url.searchParams.get("term")).toBe("Halo");
    expect(calls[1]!.url.searchParams.get("term")).toBe("Halo lyrics");
    expect(results).toHaveLength(3);
  });

  it("does not retry when the first search is already plentiful", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: {
        resultCount: 4,
        results: [1, 2, 3, 4].map((id) => track({ trackId: id })),
      },
    }));
    await searchMusic("Halo lyrics", { fetch });
    expect(calls).toHaveLength(1);
  });

  it("does not retry when normalization changed nothing", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: { resultCount: 1, results: [track({ trackId: 1 })] },
    }));
    await searchMusic("daft punk", { fetch });
    expect(calls).toHaveLength(1);
  });

  it("does not retry on an HTTP error", async () => {
    const { fetch, calls } = stubFetch(() => ({ status: 503, body: {} }));
    await expect(searchMusic("Halo lyrics", { fetch })).rejects.toThrow(/503/);
    expect(calls).toHaveLength(1);
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
