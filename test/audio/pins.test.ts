import { describe, expect, it } from "vitest";
import { createPinService } from "../../src/audio/pins";
import { ServiceError } from "../../src/audio/service-request";

function stubFetch(status: number, body: unknown) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetch = async (url: URL, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  return { fetch, calls };
}

const TOKEN = "t".repeat(40);
const config = (fetch: ReturnType<typeof stubFetch>["fetch"]) => ({
  baseUrl: "https://audio.example/",
  serviceToken: TOKEN,
  fetch,
});

describe("createPinService", () => {
  it("replaces the keep list with one PUT carrying every id", async () => {
    const { fetch, calls } = stubFetch(200, { count: 2, added: 1, removed: 3 });

    const result = await createPinService(config(fetch)).replacePins(["aaaaaaaaaaa", "bbbbbbbbbbb"]);

    expect(result).toEqual({ count: 2, added: 1, removed: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.toString()).toBe("https://audio.example/pins");
    expect(calls[0]!.init!.method).toBe("PUT");
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ video_ids: ["aaaaaaaaaaa", "bbbbbbbbbbb"] });
  });

  it("keeps mp3server's detail when it refuses", async () => {
    const { fetch } = stubFetch(422, { detail: "not a video id" });

    const error = await createPinService(config(fetch))
      .replacePins(["nope"])
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 422, message: expect.stringMatching(/not a video id/) });
  });

  it("fails on a reply it doesn't expect", async () => {
    const { fetch } = stubFetch(200, { ok: true });
    await expect(createPinService(config(fetch)).replacePins([])).rejects.toThrow();
  });

  it("needs a base URL and a service token", () => {
    const { fetch } = stubFetch(200, {});
    expect(() => createPinService({ ...config(fetch), baseUrl: "" })).toThrow(/baseUrl/);
    expect(() => createPinService({ ...config(fetch), serviceToken: "" })).toThrow(/serviceToken/);
  });
});
