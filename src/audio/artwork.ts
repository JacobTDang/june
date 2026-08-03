/** iTunes/Apple Music artwork URLs embed their pixel size as a `NNNxNNNbb`
 * path segment (e.g. `.../100x100bb.jpg`) — the size the API happened to
 * hand back, usually a thumbnail. Rewriting it in place asks the same CDN
 * for a much larger render of the same artwork. */
const ITUNES_SIZE_PATTERN = /\d+x\d+bb/;
const ITUNES_TARGET_SIZE = "600x600bb";

/** YouTube thumbnail filenames, smallest-first is NOT the order to check in:
 * `hqdefault.jpg`/`mqdefault.jpg` both end in the literal substring
 * `default.jpg`, so the more specific names must be checked (and their full
 * length stripped) before the bare `default.jpg` fallback — otherwise the
 * generic suffix match would only strip `default.jpg` and leave a stray
 * `hq`/`mq` glued to the replacement. */
const YOUTUBE_THUMBNAIL_SUFFIXES = ["hqdefault.jpg", "mqdefault.jpg", "default.jpg"];
const YOUTUBE_TARGET_SUFFIX = "maxresdefault.jpg";

/**
 * Rewrite a track's artwork URL to the highest-resolution variant available
 * from its known source, for use as a large blurred backdrop (a blown-up
 * thumbnail would look soft/blocky at that size). Pure and best-effort: a
 * URL that doesn't match a known pattern passes through unchanged, and
 * missing artwork is simply the absence of a backdrop, not an error.
 */
export function highResArtwork(url: string | null | undefined): string | null {
  if (!url) return null;

  if (ITUNES_SIZE_PATTERN.test(url)) {
    return url.replace(ITUNES_SIZE_PATTERN, ITUNES_TARGET_SIZE);
  }

  // Already at the target resolution — `maxresdefault.jpg` itself ends in
  // the literal substring `default.jpg`, so this must be checked before the
  // suffix loop below or it would double up into `maxresmaxresdefault.jpg`.
  if (url.endsWith(YOUTUBE_TARGET_SUFFIX)) return url;

  for (const suffix of YOUTUBE_THUMBNAIL_SUFFIXES) {
    if (url.endsWith(suffix)) {
      return url.slice(0, -suffix.length) + YOUTUBE_TARGET_SUFFIX;
    }
  }

  return url;
}
