import { describe, expect, it } from "vitest";
import { connectErrorText, spotifyStatusLine } from "../../src/lib/spotify/messages";

describe("connectErrorText", () => {
  it("names the not-approved case the way the spec words it", () => {
    expect(connectErrorText("not_approved")).toBe(
      "Spotify hasn't approved this account for june yet — ask Jacob to add it.",
    );
  });

  it("explains the known codes", () => {
    expect(connectErrorText("already_linked")).toMatch(/already connected to another june account/);
    expect(connectErrorText("access_denied")).toMatch(/cancelled/);
    expect(connectErrorText("state")).toMatch(/expired/);
    expect(connectErrorText("missing_code")).toMatch(/code/);
  });

  it("shows anything else verbatim rather than hiding it", () => {
    expect(connectErrorText("Spotify token request failed (500): boom")).toBe(
      "Couldn't connect Spotify: Spotify token request failed (500): boom",
    );
  });
});

describe("spotifyStatusLine", () => {
  const NOW = Date.parse("2026-09-25T12:00:00Z");

  it("says who is connected and when it last synced", () => {
    expect(
      spotifyStatusLine({ displayName: "Jacob", status: "active", lastSyncedAt: "2026-09-25T11:55:00Z" }, NOW),
    ).toBe("Connected to Spotify as Jacob · last synced 5m ago");
  });

  it("says when it hasn't synced yet", () => {
    expect(spotifyStatusLine({ displayName: null, status: "active", lastSyncedAt: null }, NOW)).toBe(
      "Connected to Spotify · not synced yet",
    );
  });

  it("asks for a reconnect once access is revoked", () => {
    expect(spotifyStatusLine({ displayName: "Jacob", status: "revoked", lastSyncedAt: null }, NOW)).toBe(
      "Spotify access was revoked. Reconnect to keep syncing.",
    );
  });
});
