import { describe, expect, it } from "vitest";
import { highResArtwork } from "../../src/audio/artwork";

describe("highResArtwork - iTunes artwork URLs", () => {
  it("rewrites a 100x100bb size segment to 600x600bb", () => {
    const url = "https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/ab/cd/100x100bb.jpg";
    expect(highResArtwork(url)).toBe(
      "https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/ab/cd/600x600bb.jpg",
    );
  });

  it("rewrites any other NNNxNNNbb size segment to 600x600bb", () => {
    const url = "https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/ab/cd/30x30bb.jpg";
    expect(highResArtwork(url)).toBe(
      "https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/ab/cd/600x600bb.jpg",
    );
  });

  it("leaves an already-600x600bb URL unchanged", () => {
    const url = "https://is1-ssl.mzstatic.com/image/thumb/Music123/v4/ab/cd/600x600bb.jpg";
    expect(highResArtwork(url)).toBe(url);
  });
});

describe("highResArtwork - YouTube thumbnail URLs", () => {
  it("rewrites hqdefault.jpg to maxresdefault.jpg", () => {
    const url = "https://i.ytimg.com/vi/abc123/hqdefault.jpg";
    expect(highResArtwork(url)).toBe("https://i.ytimg.com/vi/abc123/maxresdefault.jpg");
  });

  it("rewrites mqdefault.jpg to maxresdefault.jpg", () => {
    const url = "https://i.ytimg.com/vi/abc123/mqdefault.jpg";
    expect(highResArtwork(url)).toBe("https://i.ytimg.com/vi/abc123/maxresdefault.jpg");
  });

  it("rewrites default.jpg to maxresdefault.jpg", () => {
    const url = "https://i.ytimg.com/vi/abc123/default.jpg";
    expect(highResArtwork(url)).toBe("https://i.ytimg.com/vi/abc123/maxresdefault.jpg");
  });

  it("leaves an already-maxresdefault.jpg URL unchanged", () => {
    const url = "https://i.ytimg.com/vi/abc123/maxresdefault.jpg";
    expect(highResArtwork(url)).toBe(url);
  });
});

describe("highResArtwork - passthrough and empty input", () => {
  it("passes through a URL that matches neither pattern unchanged", () => {
    const url = "https://example.com/some/other/cover-art.png";
    expect(highResArtwork(url)).toBe(url);
  });

  it("returns null for null", () => {
    expect(highResArtwork(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(highResArtwork(undefined)).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(highResArtwork("")).toBeNull();
  });
});
