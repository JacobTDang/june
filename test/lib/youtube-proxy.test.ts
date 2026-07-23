import { describe, expect, it } from "vitest";
import { isValidWidgetPath, rewriteWidgetUrls } from "../../src/lib/youtube/proxy";

describe("rewriteWidgetUrls", () => {
  it("rewrites the real iframe_api format (escaped slashes + .vflset path)", () => {
    // Exactly what YouTube's iframe_api serves (backslash-escaped slashes).
    const src = `var scriptUrl = 'https:\\/\\/www.youtube.com\\/s\\/player\\/7a7969c2\\/www-widgetapi.vflset\\/www-widgetapi.js';`;
    const out = rewriteWidgetUrls(src);
    expect(out).toContain(
      "/api/yt-widget?path=%2Fs%2Fplayer%2F7a7969c2%2Fwww-widgetapi.vflset%2Fwww-widgetapi.js",
    );
    expect(out).not.toContain("youtube.com");
  });

  it("also handles a plain (unescaped) URL", () => {
    const src = `a.src='https://www.youtube.com/s/player/abc123XY/www-widgetapi.js';`;
    expect(rewriteWidgetUrls(src)).toBe(
      `a.src='/api/yt-widget?path=%2Fs%2Fplayer%2Fabc123XY%2Fwww-widgetapi.js';`,
    );
  });

  it("leaves other YouTube URLs (like the embed) untouched", () => {
    const src = `var e='https://www.youtube.com/embed/dQw4w9WgXcQ';`;
    expect(rewriteWidgetUrls(src)).toBe(src);
  });
});

describe("isValidWidgetPath", () => {
  it("accepts genuine widget paths, including the .vflset form", () => {
    expect(isValidWidgetPath("/s/player/abc123XY/www-widgetapi.js")).toBe(true);
    expect(isValidWidgetPath("/s/player/7a7969c2/www-widgetapi.vflset/www-widgetapi.js")).toBe(true);
  });

  it("rejects anything that isn't a widget path (SSRF guard)", () => {
    expect(isValidWidgetPath("/etc/passwd")).toBe(false);
    expect(isValidWidgetPath("/s/player/abc/www-widgetapi.js.evil")).toBe(false);
    expect(isValidWidgetPath("/s/player/abc/other.js")).toBe(false);
    expect(isValidWidgetPath("//evil.com/s/player/x/www-widgetapi.js")).toBe(false);
    expect(isValidWidgetPath("/s/player/../../etc/www-widgetapi.js")).toBe(false);
  });
});
