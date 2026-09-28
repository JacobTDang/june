import { describe, expect, it } from "vitest";
import { safeThumbnailUrl } from "../../src/lib/room/thumbnail";

describe("safeThumbnailUrl", () => {
  it("allows YouTube thumbnail hosts", () => {
    expect(safeThumbnailUrl("https://i.ytimg.com/vi/abc/hqdefault.jpg")).toBe(
      "https://i.ytimg.com/vi/abc/hqdefault.jpg",
    );
    expect(safeThumbnailUrl("https://i9.ytimg.com/vi/x/default.jpg")).toBeTruthy();
    expect(safeThumbnailUrl("https://img.youtube.com/vi/x/0.jpg")).toBeTruthy();
  });

  it("allows Apple/iTunes artwork hosts", () => {
    expect(safeThumbnailUrl("https://is1-ssl.mzstatic.com/image/thumb/x/100x100bb.jpg")).toBeTruthy();
  });

  it("rejects an arbitrary attacker host (the IP-leak vector)", () => {
    expect(safeThumbnailUrl("https://attacker.com/pixel.png")).toBeNull();
  });

  it("rejects suffix-spoofing lookalikes", () => {
    expect(safeThumbnailUrl("https://evil.ytimg.com.attacker.com/p.png")).toBeNull();
    expect(safeThumbnailUrl("https://notytimg.com/p.png")).toBeNull();
    expect(safeThumbnailUrl("https://ytimg.com/p.png")).toBeNull(); // bare apex, never used by YT
  });

  it("requires https (no http, data:, javascript:, protocol-relative)", () => {
    expect(safeThumbnailUrl("http://i.ytimg.com/vi/x/0.jpg")).toBeNull();
    expect(safeThumbnailUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(safeThumbnailUrl("javascript:alert(1)")).toBeNull();
    expect(safeThumbnailUrl("//i.ytimg.com/vi/x/0.jpg")).toBeNull();
  });

  it("returns null for empty/malformed input", () => {
    expect(safeThumbnailUrl(null)).toBeNull();
    expect(safeThumbnailUrl(undefined)).toBeNull();
    expect(safeThumbnailUrl("")).toBeNull();
    expect(safeThumbnailUrl("not a url")).toBeNull();
  });

  it("allows Spotify album art hosts", () => {
    expect(safeThumbnailUrl("https://i.scdn.co/image/ab67616d0000b273abc")).toBe(
      "https://i.scdn.co/image/ab67616d0000b273abc",
    );
    expect(safeThumbnailUrl("https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e02abc")).toBeTruthy();
  });

  it("rejects Spotify lookalikes", () => {
    expect(safeThumbnailUrl("https://i.scdn.co.attacker.com/p.png")).toBeNull();
    expect(safeThumbnailUrl("https://notspotifycdn.com/p.png")).toBeNull();
  });
});
