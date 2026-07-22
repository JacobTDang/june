/**
 * Track metadata reaches `enqueueTrack` partly from client-supplied input
 * (`addCandidate` trusts the picked candidate's artwork), and the thumbnail is
 * rendered as an <img src> for every participant. An attacker in the room could
 * otherwise point it at their own host and log every other participant's IP and
 * User-Agent. Only allow thumbnails from the providers we actually use, so a
 * rogue URL is dropped (the UI falls back to its music-note placeholder).
 */
const ALLOWED_HOST_SUFFIXES = [".ytimg.com", ".mzstatic.com"];
const ALLOWED_HOSTS = ["img.youtube.com"];

export function safeThumbnailUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null; // not an absolute URL (rejects protocol-relative and garbage)
  }
  if (parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  if (ALLOWED_HOSTS.includes(host)) return url;
  if (ALLOWED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return url;
  return null;
}
