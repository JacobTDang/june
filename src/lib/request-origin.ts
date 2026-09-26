/**
 * The origin the browser actually used. `next dev` builds `request.url` from
 * its own configured hostname — localhost — whatever address the browser
 * typed, so a redirect built from it can land somewhere the session and OAuth
 * state cookies don't exist. The Host header is what the browser sent; on
 * Vercel it is the deployment's real domain, the same one `request.url` has.
 */
export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  // HTTP/1.1 requires a Host header; without one the URL is all there is.
  if (!host) return url.origin;
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwarded || url.protocol.replace(/:$/, "");
  return `${protocol}://${host}`;
}
