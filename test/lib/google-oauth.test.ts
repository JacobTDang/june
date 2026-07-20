import { describe, expect, it, vi } from "vitest";
import { refreshAccessToken } from "../../src/lib/supabase/google-oauth";

const config = { clientId: "cid", clientSecret: "secret" };

function fetchReturning(status: number, json: unknown): typeof fetch {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => json,
    text: async () => JSON.stringify(json),
  })) as unknown as typeof fetch;
}

describe("refreshAccessToken", () => {
  it("posts the refresh grant and returns the new access token", async () => {
    const fetchMock = fetchReturning(200, { access_token: "fresh-token", expires_in: 3599 });
    const token = await refreshAccessToken("rt", config, { fetch: fetchMock });

    expect(token).toBe("fresh-token");
    const [url, init] = (fetchMock as unknown as { mock: { calls: [string, RequestInit][] } }).mock
      .calls[0]!;
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt");
    expect(body.get("client_id")).toBe("cid");
    expect(body.get("client_secret")).toBe("secret");
  });

  it("throws when the OAuth client isn't configured", async () => {
    await expect(refreshAccessToken("rt", { clientId: "", clientSecret: "" })).rejects.toThrow(
      /not configured/i,
    );
  });

  it("throws when there is no refresh token", async () => {
    await expect(refreshAccessToken("", config)).rejects.toThrow(/no.*refresh token/i);
  });

  it("throws loudly on a non-OK response (e.g. revoked grant)", async () => {
    const fetchMock = fetchReturning(400, { error: "invalid_grant" });
    await expect(refreshAccessToken("rt", config, { fetch: fetchMock })).rejects.toThrow(
      /refresh failed/i,
    );
  });

  it("throws when the response carries no access token", async () => {
    const fetchMock = fetchReturning(200, {});
    await expect(refreshAccessToken("rt", config, { fetch: fetchMock })).rejects.toThrow(
      /no access token/i,
    );
  });
});
