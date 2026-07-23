import { describe, expect, it } from "vitest";
import { searchArtists, getArtistTopSongs, getTrackById } from "../../src/discovery/itunes";

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

const artistRow = (over: Record<string, unknown> = {}) => ({
  wrapperType: "artist",
  artistId: 1,
  artistName: "Daft Punk",
  primaryGenreName: "Electronic",
  ...over,
});

const songRow = (over: Record<string, unknown> = {}) => ({
  wrapperType: "track",
  trackId: 10,
  trackName: "Song",
  artistName: "Daft Punk",
  artworkUrl100: "art",
  trackTimeMillis: 300_000,
  ...over,
});

describe("searchArtists", () => {
  it("builds the musicArtist request with a normalized term and maps rows", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: {
        resultCount: 2,
        results: [
          artistRow({ artistId: 1, artistName: "Daft Punk", primaryGenreName: "Electronic" }),
          artistRow({ artistId: 2, artistName: "Justice", primaryGenreName: "Dance" }),
        ],
      },
    }));

    const artists = await searchArtists("Daft Punk lyrics", { fetch });

    expect(calls[0]!.url.searchParams.get("entity")).toBe("musicArtist");
    expect(calls[0]!.url.searchParams.get("media")).toBe("music");
    expect(calls[0]!.url.searchParams.get("term")).toBe("Daft Punk");
    expect(artists).toEqual([
      { artistId: "1", name: "Daft Punk", genre: "Electronic", source: "itunes" },
      { artistId: "2", name: "Justice", genre: "Dance", source: "itunes" },
    ]);
  });

  it("omits genre when absent and never invents artwork", async () => {
    const { fetch } = stubFetch(() => ({
      body: { resultCount: 1, results: [{ wrapperType: "artist", artistId: 9, artistName: "Solo" }] },
    }));
    const artists = await searchArtists("solo", { fetch });
    expect(artists[0]).toEqual({ artistId: "9", name: "Solo", source: "itunes" });
  });

  it("drops rows missing an artistId or name", async () => {
    const { fetch } = stubFetch(() => ({
      body: {
        resultCount: 3,
        results: [
          artistRow({ artistId: 1, artistName: "Ok" }),
          artistRow({ artistId: undefined, artistName: "NoId" }),
          artistRow({ artistId: 2, artistName: undefined }),
        ],
      },
    }));
    const artists = await searchArtists("x", { fetch });
    expect(artists.map((a) => a.artistId)).toEqual(["1"]);
  });

  it("defaults the limit to 5", async () => {
    const { fetch, calls } = stubFetch(() => ({ body: { resultCount: 0, results: [] } }));
    await searchArtists("x", { fetch });
    expect(calls[0]!.url.searchParams.get("limit")).toBe("5");
  });

  it("throws on a non-200 response", async () => {
    const { fetch } = stubFetch(() => ({ status: 503, body: {} }));
    await expect(searchArtists("x", { fetch })).rejects.toThrow(/iTunes Search API 503/);
  });
});

describe("getArtistTopSongs", () => {
  it("looks up an artist's songs, drops the artist wrapper, and ranks them", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: {
        resultCount: 4,
        results: [
          artistRow({ artistId: 1, artistName: "Daft Punk" }),
          songRow({ trackId: 10, trackName: "Around the World" }),
          songRow({ trackId: 11, trackName: "One More Time (Karaoke)" }),
          songRow({ trackId: 12, trackName: "Digital Love" }),
        ],
      },
    }));

    const songs = await getArtistTopSongs("1", { fetch });

    expect(calls[0]!.url.pathname).toBe("/lookup");
    expect(calls[0]!.url.searchParams.get("id")).toBe("1");
    expect(calls[0]!.url.searchParams.get("entity")).toBe("song");
    expect(songs.map((s) => s.sourceId)).toEqual(["10", "12", "11"]);
  });

  it("defaults the limit to 12", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: { resultCount: 1, results: [songRow({ trackId: 10 })] },
    }));
    await getArtistTopSongs("1", { fetch });
    expect(calls[0]!.url.searchParams.get("limit")).toBe("12");
  });

  it("throws on a non-200 response", async () => {
    const { fetch } = stubFetch(() => ({ status: 500, body: {} }));
    await expect(getArtistTopSongs("1", { fetch })).rejects.toThrow(/iTunes Search API 500/);
  });
});

describe("getTrackById", () => {
  it("looks up a track by id and returns the matching candidate", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: {
        resultCount: 1,
        results: [songRow({ trackId: 555, trackName: "Real Song", artistName: "Real Artist" })],
      },
    }));

    const track = await getTrackById("555", { fetch });

    expect(calls[0]!.url.pathname).toBe("/lookup");
    expect(calls[0]!.url.searchParams.get("id")).toBe("555");
    expect(track).toMatchObject({ sourceId: "555", title: "Real Song", artist: "Real Artist" });
  });

  it("returns null when the id resolves to nothing", async () => {
    const { fetch } = stubFetch(() => ({ body: { resultCount: 0, results: [] } }));
    expect(await getTrackById("999", { fetch })).toBeNull();
  });

  it("throws on a non-200 response", async () => {
    const { fetch } = stubFetch(() => ({ status: 500, body: {} }));
    await expect(getTrackById("1", { fetch })).rejects.toThrow(/iTunes Search API 500/);
  });
});
