/**
 * Classify a YouTube/Google error so the UI can show a calm, actionable state
 * instead of echoing a raw exception. Import-clean (no server-only) so it works
 * in both server components and client code, and is unit-testable directly.
 *
 * - `not-configured`: server is missing GOOGLE_CLIENT_ID/SECRET or YOUTUBE_API_KEY.
 * - `not-connected`:  the user hasn't linked (or must relink) their YouTube account.
 * - `failed`:         a genuine failure - surfaced verbatim (fail loud).
 */
export type YouTubeErrorKind = "not-configured" | "not-connected" | "failed";

export interface YouTubeErrorInfo {
  kind: YouTubeErrorKind;
  message: string;
}

export function describeYouTubeError(err: unknown): YouTubeErrorInfo {
  const message = err instanceof Error ? err.message : String(err);
  const m = message.toLowerCase();

  if (m.includes("not configured")) return { kind: "not-configured", message };
  if (
    m.includes("connect your youtube") ||
    m.includes("connect youtube") ||
    m.includes("refresh token")
  ) {
    return { kind: "not-connected", message };
  }
  return { kind: "failed", message };
}

/** User-facing copy for an error info: calm for setup/connection, verbatim for failures. */
export function youTubeNoticeText(info: YouTubeErrorInfo): string {
  if (info.kind === "not-configured") return "YouTube isn’t set up on this server yet.";
  if (info.kind === "not-connected") {
    return "Connect your YouTube account from the home page to import playlists.";
  }
  return info.message;
}

/** Either an action's data, or a calm notice to show the user. */
export type YouTubeResult<T> = { ok: true; data: T } | { ok: false; notice: string };

/**
 * Run a YouTube-touching action and return either its data or a user-facing
 * notice — never throw for an expected state. Classifying here, on the server
 * where the real error message still exists, is the whole point: Next.js redacts
 * *thrown* server-action errors in production, so a client-side classifier only
 * ever sees the generic redaction. A returned value isn't redacted, so the
 * notice survives the boundary intact.
 */
export async function runYouTube<T>(fn: () => Promise<T>): Promise<YouTubeResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    const info = describeYouTubeError(err);
    // A genuine failure is a bug or an outage — log it (fail loud), since we're
    // now catching what Next/Vercel would otherwise surface. Expected states
    // (not-connected / not-configured) are normal and don't warrant a log.
    if (info.kind === "failed") console.error("YouTube operation failed:", err);
    return { ok: false, notice: youTubeNoticeText(info) };
  }
}
