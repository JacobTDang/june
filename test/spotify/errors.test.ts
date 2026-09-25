import { describe, expect, it } from "vitest";
import {
  classifySyncError,
  isNotApprovedForApp,
  SpotifyApiError,
  SpotifyAuthError,
} from "../../src/spotify/errors";

describe("classifySyncError", () => {
  it("treats a 429 as rate-limited and keeps Retry-After", () => {
    const failure = classifySyncError(new SpotifyApiError(429, "slow down", 30));
    expect(failure).toEqual({ kind: "rate-limited", message: "slow down", retryAfterSeconds: 30 });
  });

  it("treats a revoked grant as revoked", () => {
    const failure = classifySyncError(new SpotifyAuthError("invalid_grant", "Refresh token revoked"));
    expect(failure).toEqual({ kind: "revoked", message: "Refresh token revoked" });
  });

  it("treats any other API error as a failure for that user alone", () => {
    expect(classifySyncError(new SpotifyApiError(500, "boom"))).toEqual({
      kind: "failed",
      message: "boom",
    });
  });

  it("keeps the message of an unexpected error", () => {
    expect(classifySyncError(new Error("db down"))).toEqual({ kind: "failed", message: "db down" });
    expect(classifySyncError("weird")).toEqual({ kind: "failed", message: "weird" });
  });
});

describe("isNotApprovedForApp", () => {
  it("is true only for a 403 from the Web API", () => {
    expect(isNotApprovedForApp(new SpotifyApiError(403, "user may not be registered"))).toBe(true);
    expect(isNotApprovedForApp(new SpotifyApiError(401, "expired"))).toBe(false);
    expect(isNotApprovedForApp(new SpotifyAuthError("invalid_client", "bad"))).toBe(false);
  });
});
