import { describe, expect, it } from "vitest";
import { createImportService } from "../../src/audio/imports";
import { ServiceError } from "../../src/audio/service-request";

type Reply = { status?: number; body: unknown };

function stubFetch(handler: (url: URL, init?: RequestInit) => Reply) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetch = async (url: URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const { status = 200, body } = handler(url, init);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

const TOKEN = "t".repeat(40);
const base = { baseUrl: "https://audio.example/", serviceToken: TOKEN };
const header = (init?: RequestInit) => (init?.headers as Record<string, string>).Authorization;

describe("createImportService", () => {
  it("needs a base URL and a service token", () => {
    expect(() => createImportService({ baseUrl: "", serviceToken: TOKEN })).toThrow(/baseUrl/);
    expect(() => createImportService({ baseUrl: "https://a", serviceToken: "" })).toThrow(/serviceToken/);
  });

  it("creates an import with the service token and snake_case lengths", async () => {
    const { fetch, calls } = stubFetch(() => ({ status: 202, body: { id: "job-1", kind: "import", status: "running", total: 2 } }));
    const created = await createImportService({ ...base, fetch }).createImport([
      { title: "Glory Box", artist: "Portishead", durationMs: 305_000 },
      { title: "Roads", artist: "Portishead", durationMs: null },
    ]);

    expect(created).toEqual({ id: "job-1", total: 2 });
    expect(calls[0]!.url.toString()).toBe("https://audio.example/imports");
    expect(calls[0]!.init!.method).toBe("POST");
    expect(header(calls[0]!.init)).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({
      tracks: [
        { title: "Glory Box", artist: "Portishead", duration_ms: 305_000 },
        { title: "Roads", artist: "Portishead", duration_ms: null },
      ],
    });
  });

  it("reads an import's per-track results", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: {
        id: "job-1",
        status: "partial",
        total: 2,
        done: 2,
        tracks: [
          { title: "Glory Box", artist: "Portishead", state: "resolved", video_id: "v1", matched_title: "Glory Box", confidence: "high", matched_duration_ms: 306_000 },
          { title: "Roads", artist: "Portishead", state: "not_found" },
        ],
      },
    }));
    const status = await createImportService({ ...base, fetch }).getImport("job-1");

    expect(status?.tracks[0]?.video_id).toBe("v1");
    expect(status?.tracks[0]?.matched_duration_ms).toBe(306_000);
    expect(status?.tracks[1]?.state).toBe("not_found");
    expect(calls[0]!.url.pathname).toBe("/imports/job-1");
  });

  it("says an import the server no longer has is gone", async () => {
    const { fetch } = stubFetch(() => ({ status: 404, body: { detail: "import not found" } }));
    expect(await createImportService({ ...base, fetch }).getImport("old")).toBeNull();
  });

  it("fails on any other 404, such as a proxy's, rather than calling the import gone", async () => {
    const { fetch } = stubFetch(() => ({ status: 404, body: { detail: "Not Found" } }));
    const error = await createImportService({ ...base, fetch })
      .getImport("job-1")
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 404, message: expect.stringMatching(/Not Found/) });
  });

  it("matches one track", async () => {
    const { fetch, calls } = stubFetch(() => ({
      body: { state: "resolved", video_id: "v1", matched_title: "Glory Box", confidence: "low", matched_duration_ms: 318_000 },
    }));
    const result = await createImportService({ ...base, fetch }).matchOne({
      title: "Glory Box",
      artist: "Portishead",
      durationMs: 305_000,
    });

    expect(result.state).toBe("resolved");
    expect(result.confidence).toBe("low");
    expect(calls[0]!.url.pathname).toBe("/match");
  });

  it("keeps the server's detail on an error", async () => {
    const { fetch } = stubFetch(() => ({ status: 502, body: { detail: "search failed: not a bot" } }));
    const error = await createImportService({ ...base, fetch })
      .matchOne({ title: "x", artist: "y", durationMs: null })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 502, message: expect.stringMatching(/not a bot/) });
  });

  it("fails on a shape it doesn't expect", async () => {
    const { fetch } = stubFetch(() => ({ body: { nope: true } }));
    await expect(
      createImportService({ ...base, fetch }).matchOne({ title: "x", artist: "y", durationMs: null }),
    ).rejects.toThrow();
  });
});
