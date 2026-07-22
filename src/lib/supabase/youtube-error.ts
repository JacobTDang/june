/**
 * Classify a YouTube/Google error so the UI can show a calm, actionable state
 * instead of echoing a raw exception. Import-clean (no server-only) so it works
 * in both server components and client code, and is unit-testable directly.
 *
 * - `not-configured`: server is missing GOOGLE_CLIENT_ID/SECRET or YOUTUBE_API_KEY.
 * - `not-connected`:  the user hasn't linked (or must relink) their YouTube account.
 * - `failed`:         a genuine failure — surfaced verbatim (fail loud).
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
