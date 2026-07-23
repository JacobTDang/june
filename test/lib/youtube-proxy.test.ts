import { describe, expect, it } from "vitest";
import { isValidWidgetPath, rewriteWidgetUrls } from "../../src/lib/youtube/proxy";

describe("rewriteWidgetUrls", () => {
  it("routes the widget script through our proxy", () => {
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
  it("accepts a genuine widget path", () => {
    expect(isValidWidgetPath("/s/player/abc123XY/www-widgetapi.js")).toBe(true);
    expect(isValidWidgetPath("/s/player/ab_c-1/es6/www-widgetapi.js")).toBe(true);
  });

  it("rejects anything that isn't a widget path (SSRF guard)", () => {
    expect(isValidWidgetPath("/etc/passwd")).toBe(false);
    expect(isValidWidgetPath("/s/player/abc/www-widgetapi.js.evil")).toBe(false);
    expect(isValidWidgetPath("/s/player/abc/other.js")).toBe(false);
    expect(isValidWidgetPath("//evil.com/s/player/x/www-widgetapi.js")).toBe(false);
  });
});
