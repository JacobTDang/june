import { describe, expect, it } from "vitest";
import { createSpotifyClient } from "../../src/spotify/client";
import { SpotifyApiError } from "../../src/spotify/errors";

type Reply = { status?: number; body: unknown; headers?: Record<string, string> };

/** Records requested URLs and answers per handler, like test/youtube/client.test.ts. */
function stubFetch(handler: (url: URL) => Reply) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetch = async (url: URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const { status = 200, body, headers = {} } = handler(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  };
  return { fetch, calls };
}

const track = (id: string) => ({ type: "track", id, name: `T${id}`, artists: [{ name: "A" }] });
const playlistJson = (id: string) => ({
  id,
  name: id,
  collaborative: false,
  owner: { id: "me" },
  snapshot_id: "s",
});

describe("createSpotifyClient", () => {
  it("requires an access token", () => {
    expect(() => createSpotifyClient({ accessToken: "" })).toThrow(/accessToken is required/);
  });

  it("sends the bearer token and reads the current user", async () => {
    const { fetch, calls } = stubFetch(() => ({ body: { id: "me", display_name: "Me" } }));
    const me = await createSpotifyClient({ accessToken: "tok", fetch }).me();

    expect(me).toEqual({ id: "me", display_name: "Me" });
    expect(calls[0]!.url.toString()).toBe("https://api.spotify.com/v1/me");
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("asks for plays after the cursor, 50 at a time", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: { items: [{ track: track("a"), played_at: "2026-09-25T11:00:00.000Z" }] },
    }));
    const client = createSpotifyClient({ accessToken: "tok", fetch });

    const items = await client.recentlyPlayed(1_758_000_000_000);
    expect(items).toHaveLength(1);
    expect(calls[0]!.url.pathname).toBe("/v1/me/player/recently-played");
    expect(calls[0]!.url.searchParams.get("after")).toBe("1758000000000");
    expect(calls[0]!.url.searchParams.get("limit")).toBe("50");

    await client.recentlyPlayed(null);
    expect(calls[1]!.url.searchParams.has("after")).toBe(false);
  });

  it("reads one page of saved tracks at the offset given", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: { items: [{ added_at: "2026-09-20T00:00:00Z", track: track("a") }], next: null },
    }));
    const page = await createSpotifyClient({ accessToken: "tok", fetch }).savedTracks(100);

    expect(page.next).toBeNull();
    expect(calls[0]!.url.pathname).toBe("/v1/me/tracks");
    expect(calls[0]!.url.searchParams.get("offset")).toBe("100");
    expect(calls[0]!.url.searchParams.get("limit")).toBe("50");
  });

  it("follows playlist pages until next is null", async () => {
    const { fetch, calls } = stubFetch((url) =>
      url.searchParams.get("offset") === "0"
        ? { body: { items: [playlistJson("p1")], next: "https://api.spotify.com/v1/me/playlists?offset=50" } }
        : { body: { items: [playlistJson("p2")], next: null } },
    );
    const playlists = await createSpotifyClient({ accessToken: "tok", fetch }).myPlaylists();

    expect(playlists.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(calls.map((c) => c.url.searchParams.get("offset"))).toEqual(["0", "50"]);
  });

  it("reads a playlist's entries from /items", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: { items: [{ added_at: null, item: track("a") }], next: null },
    }));
    const items = await createSpotifyClient({ accessToken: "tok", fetch }).playlistItems("pl 1");

    expect(items[0]?.item?.id).toBe("a");
    expect(calls[0]!.url.pathname).toBe("/v1/playlists/pl%201/items");
  });

  it("asks for top items by time range", async () => {
    const { fetch, calls } = stubFetch((url) =>
      url.pathname.endsWith("/artists")
        ? { body: { items: [{ id: "ar1", name: "Portishead" }] } }
        : { body: { items: [track("a")] } },
    );
    const client = createSpotifyClient({ accessToken: "tok", fetch });

    expect((await client.topArtists("short_term"))[0]?.name).toBe("Portishead");
    expect((await client.topTracks("long_term"))[0]?.id).toBe("a");
    expect(calls[0]!.url.searchParams.get("time_range")).toBe("short_term");
    expect(calls[1]!.url.pathname).toBe("/v1/me/top/tracks");
    expect(calls[1]!.url.searchParams.get("limit")).toBe("50");
  });

  it("throws SpotifyApiError with Retry-After on a 429", async () => {
    const { fetch } = stubFetch(() => ({
      status: 429,
      body: { error: { status: 429, message: "API rate limit exceeded" } },
      headers: { "retry-after": "30" },
    }));
    const error = await createSpotifyClient({ accessToken: "tok", fetch })
      .me()
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(SpotifyApiError);
    expect(error).toMatchObject({ status: 429, retryAfterSeconds: 30 });
    expect((error as Error).message).toMatch(/API rate limit exceeded/);
  });

  it("keeps Spotify's message on other errors", async () => {
    const { fetch } = stubFetch(() => ({
      status: 403,
      body: { error: { status: 403, message: "User not registered in the Developer Dashboard" } },
    }));
    await expect(createSpotifyClient({ accessToken: "tok", fetch }).me()).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(/not registered/),
    });
  });

  it("fails on a shape it doesn't expect", async () => {
    const { fetch } = stubFetch(() => ({ body: { nope: true } }));
    await expect(createSpotifyClient({ accessToken: "tok", fetch }).me()).rejects.toThrow();
  });
});
