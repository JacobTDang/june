import { isValidWidgetPath } from "@/src/lib/youtube/proxy";

const JS_HEADERS = { "content-type": "text/javascript; charset=utf-8" };
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * Same-origin proxy for the YouTube widget script that iframe_api pulls in, in
 * case a blocker also filters `/s/player/` paths. The path is validated to be a
 * genuine YouTube widget script (SSRF guard) before we fetch it.
 */
export async function GET(request: Request) {
  const path = new URL(request.url).searchParams.get("path") ?? "";
  if (!isValidWidgetPath(path)) {
    return new Response("// june: invalid widget path", { status: 400, headers: JS_HEADERS });
  }
  let res: Response;
  try {
    res = await fetch(`https://www.youtube.com${path}`, { headers: { "user-agent": UA } });
  } catch {
    return new Response("// june: couldn't reach YouTube", { status: 502, headers: JS_HEADERS });
  }
  const js = await res.text();
  // Widget scripts are versioned by hash, so they're safe to cache hard.
  return new Response(js, {
    status: res.ok ? 200 : 502,
    headers: { ...JS_HEADERS, "cache-control": "public, max-age=86400, s-maxage=86400" },
  });
}
