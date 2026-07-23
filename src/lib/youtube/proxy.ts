/**
 * Helpers for same-origin proxying of YouTube's iframe player scripts, so an ad
 * blocker that filters `youtube.com/...` URLs can't stop the embed from loading
 * (the browser only ever sees a request to our own origin). Pure + testable; the
 * fetch glue lives in the /api/yt-* route handlers.
 */

// The iframe_api bootstrap injects a widget script; route it through us too, in
// case the blocker also filters /s/player/ paths. YouTube serves the URL with
// backslash-escaped slashes (`\/`) and a `.vflset` segment, e.g.
//   https:\/\/www.youtube.com\/s\/player\/HASH\/www-widgetapi.vflset\/www-widgetapi.js
// so match slashes as optionally-escaped and allow dots in the path.
const WIDGET_URL_RE = /https:(?:\\?\/){2}www\.youtube\.com((?:\\?\/[\w.-]+)*\\?\/www-widgetapi\.js)/g;

/** Rewrite the widget-script URL inside iframe_api to point at our proxy. */
export function rewriteWidgetUrls(js: string): string {
  return js.replace(WIDGET_URL_RE, (_m, raw: string) => {
    const path = raw.replace(/\\\//g, "/"); // unescape \/ → /
    return `/api/yt-widget?path=${encodeURIComponent(path)}`;
  });
}

/** SSRF guard: only ever proxy a genuine YouTube widget-script path. */
export function isValidWidgetPath(path: string): boolean {
  return /^\/s\/player\/[A-Za-z0-9._/-]+\/www-widgetapi\.js$/.test(path) && !path.includes("..");
}
