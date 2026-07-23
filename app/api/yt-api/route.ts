import { rewriteWidgetUrls } from "@/src/lib/youtube/proxy";

const JS_HEADERS = { "content-type": "text/javascript; charset=utf-8" };
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/**
 * Same-origin proxy for YouTube's iframe_api bootstrap. An ad blocker filters
 * `youtube.com/iframe_api`, but not a request to our own origin — so this lets
 * the embed load with the blocker on. It serves YouTube's own public script (no
 * content re-hosting), with the widget-script URL rewritten to our widget proxy.
 */
export async function GET() {
  let res: Response;
  try {
    res = await fetch("https://www.youtube.com/iframe_api", { headers: { "user-agent": UA } });
  } catch {
    return new Response("// june: couldn't reach YouTube", { status: 502, headers: JS_HEADERS });
  }
  if (!res.ok) {
    return new Response(`// june: YouTube returned ${res.status}`, { status: 502, headers: JS_HEADERS });
  }
  const js = rewriteWidgetUrls(await res.text());
  return new Response(js, {
    status: 200,
    headers: { ...JS_HEADERS, "cache-control": "public, max-age=600, s-maxage=600" },
  });
}
