import { describe, expect, it } from "vitest";
import { createAudioServer } from "../../src/audio/client";

/** A fetch stub that records requested URLs + init, and replies per handler. */
function stubFetch(handler: (url: URL) => { status?: number; body?: unknown }) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetch = async (url: URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const { status = 200, body = {} } = handler(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

const token = async () => "tok";

describe("mintStreamUrl", () => {
  it("mints an absolute stream URL with the bearer token", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: { url: "/files/abc/stream?exp=1&sig=s", expires_at: 1 },
    }));
    const server = createAudioServer({
      baseUrl: "https://audio.test",
      getAccessToken: token,
      fetch,
    });

    const url = await server.mintStreamUrl("vid1");

    expect(url).toBe("https://audio.test/files/abc/stream?exp=1&sig=s");
    expect(calls[0]!.url.toString()).toBe("https://audio.test/files/by-video/vid1/link");
    expect(calls[0]!.init?.method).toBe("POST");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
  });

  it("returns null when the track is not stored yet", async () => {
    const { fetch } = stubFetch(() => ({ status: 404, body: { detail: "no stored file" } }));
    const server = createAudioServer({
      baseUrl: "https://audio.test",
      getAccessToken: token,
      fetch,
    });

    expect(await server.mintStreamUrl("vid1")).toBeNull();
  });

  it("throws on any other error status", async () => {
    const { fetch } = stubFetch(() => ({ status: 503, body: { detail: "no secret" } }));
    const server = createAudioServer({
      baseUrl: "https://audio.test",
      getAccessToken: token,
      fetch,
    });

    await expect(server.mintStreamUrl("vid1")).rejects.toThrow("audio server 503: no secret");
  });

  it("throws when there is no session", async () => {
    const { fetch } = stubFetch(() => ({ body: {} }));
    const server = createAudioServer({
      baseUrl: "https://audio.test",
      getAccessToken: async () => null,
      fetch,
    });

    await expect(server.mintStreamUrl("vid1")).rejects.toThrow("not signed in");
  });
});

describe("ensureDownload", () => {
  it("posts the watch URL and reports queued", async () => {
    const { fetch, calls } = stubFetch(() => ({ status: 202, body: { id: "j", status: "queued" } }));
    const server = createAudioServer({
      baseUrl: "https://audio.test",
      getAccessToken: token,
      fetch,
    });

    expect(await server.ensureDownload("vid1")).toBe("queued");
    expect(calls[0]!.url.toString()).toBe("https://audio.test/downloads");
    expect(JSON.parse(calls[0]!.init?.body as string)).toEqual({
      url: "https://www.youtube.com/watch?v=vid1",
    });
  });

  it("reports throttled when the pending cap is hit", async () => {
    const { fetch } = stubFetch(() => ({ status: 429, body: { detail: "too many pending" } }));
    const server = createAudioServer({
      baseUrl: "https://audio.test",
      getAccessToken: token,
      fetch,
    });

    expect(await server.ensureDownload("vid1")).toBe("throttled");
  });

  it("throws on any other error status", async () => {
    const { fetch } = stubFetch(() => ({ status: 503, body: { detail: "queue unavailable" } }));
    const server = createAudioServer({
      baseUrl: "https://audio.test",
      getAccessToken: token,
      fetch,
    });

    await expect(server.ensureDownload("vid1")).rejects.toThrow(
      "audio server 503: queue unavailable",
    );
  });
});

describe("listDownloads", () => {
  it("gets the job list with the bearer token", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: [
        { id: "j1", url: "https://www.youtube.com/watch?v=vid1", status: "running", progress: 40, created_at: "2026-08-03T11:00:00" },
      ],
    }));
    const server = createAudioServer({
      baseUrl: "https://audio.test",
      getAccessToken: token,
      fetch,
    });

    const jobs = await server.listDownloads();

    expect(jobs).toEqual([
      { id: "j1", url: "https://www.youtube.com/watch?v=vid1", status: "running", progress: 40, created_at: "2026-08-03T11:00:00" },
    ]);
    expect(calls[0]!.url.toString()).toBe("https://audio.test/downloads");
    expect(calls[0]!.init?.method).toBe("GET");
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("passes the limit as a query param", async () => {
    const { fetch, calls } = stubFetch(() => ({ body: [] }));
    const server = createAudioServer({
      baseUrl: "https://audio.test",
      getAccessToken: token,
      fetch,
    });

    await server.listDownloads(5);

    expect(calls[0]!.url.toString()).toBe("https://audio.test/downloads?limit=5");
  });

  it("throws on any other error status", async () => {
    const { fetch } = stubFetch(() => ({ status: 503, body: { detail: "unavailable" } }));
    const server = createAudioServer({
      baseUrl: "https://audio.test",
      getAccessToken: token,
      fetch,
    });

    await expect(server.listDownloads()).rejects.toThrow("audio server 503: unavailable");
  });

  it("throws when there is no session", async () => {
    const { fetch } = stubFetch(() => ({ body: [] }));
    const server = createAudioServer({
      baseUrl: "https://audio.test",
      getAccessToken: async () => null,
      fetch,
    });

    await expect(server.listDownloads()).rejects.toThrow("not signed in");
  });
});
