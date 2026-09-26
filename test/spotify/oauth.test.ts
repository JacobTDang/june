import { describe, expect, it } from "vitest";
import {
  authorizeUrl,
  exchangeCode,
  refreshTokens,
  SPOTIFY_SCOPES,
  stateCookieValue,
  stateMatches,
} from "../../src/spotify/oauth";

const config = { clientId: "cid", clientSecret: "secret" };
const now = () => new Date("2026-09-25T12:00:00Z");
const REDIRECT = "http://127.0.0.1:3000/api/spotify/callback";

function tokenFetch(status: number, body: unknown) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, calls };
}

describe("authorizeUrl", () => {
  it("asks for a code, every scope, and carries the state", () => {
    const url = new URL(authorizeUrl({ clientId: "cid", redirectUri: REDIRECT, state: "nonce" }));
    expect(`${url.origin}${url.pathname}`).toBe("https://accounts.spotify.com/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("nonce");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([...SPOTIFY_SCOPES]);
  });
});

describe("exchangeCode", () => {
  it("posts the code with basic auth and says when the token expires", async () => {
    const { fetch, calls } = tokenFetch(200, {
      access_token: "at",
      expires_in: 3600,
      refresh_token: "rt",
    });
    const tokens = await exchangeCode("code1", REDIRECT, config, { fetch, now });

    expect(tokens).toEqual({
      accessToken: "at",
      refreshToken: "rt",
      expiresAt: new Date("2026-09-25T13:00:00Z"),
    });
    expect(calls[0]!.url).toBe("https://accounts.spotify.com/api/token");
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Basic ${btoa("cid:secret")}`);
    const body = new URLSearchParams(calls[0]!.init!.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code1");
    expect(body.get("redirect_uri")).toBe(REDIRECT);
  });
});

describe("refreshTokens", () => {
  it("returns no refresh token when Spotify keeps the old one", async () => {
    const { fetch, calls } = tokenFetch(200, { access_token: "at2", expires_in: 3600 });
    const tokens = await refreshTokens("rt", config, { fetch, now });

    expect(tokens.refreshToken).toBeNull();
    expect(tokens.accessToken).toBe("at2");
    const body = new URLSearchParams(calls[0]!.init!.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt");
  });

  it("returns the rotated refresh token when there is one", async () => {
    const { fetch } = tokenFetch(200, { access_token: "at2", expires_in: 3600, refresh_token: "rt2" });
    expect((await refreshTokens("rt", config, { fetch, now })).refreshToken).toBe("rt2");
  });

  it("turns a revoked grant into SpotifyAuthError('invalid_grant')", async () => {
    const { fetch } = tokenFetch(400, {
      error: "invalid_grant",
      error_description: "Refresh token revoked",
    });
    await expect(refreshTokens("rt", config, { fetch, now })).rejects.toMatchObject({
      name: "SpotifyAuthError",
      code: "invalid_grant",
    });
  });

  it("refuses to run without a client id and secret", async () => {
    await expect(refreshTokens("rt", { clientId: "", clientSecret: "" })).rejects.toThrow(
      /not configured/i,
    );
  });
});

describe("state", () => {
  it("matches only the same nonce for the same user", () => {
    const cookie = stateCookieValue("user-1", "nonce");
    expect(stateMatches(cookie, "nonce", "user-1")).toBe(true);
    expect(stateMatches(cookie, "other", "user-1")).toBe(false);
    expect(stateMatches(cookie, "nonce", "user-2")).toBe(false);
    expect(stateMatches(undefined, "nonce", "user-1")).toBe(false);
    expect(stateMatches(cookie, null, "user-1")).toBe(false);
  });
});
