/**
 * Sanitize a `next` redirect target so it can only point somewhere inside this
 * app. Anything that isn't a plain internal path - absolute URLs, protocol-
 * relative `//host`, backslash tricks, `javascript:` - collapses to the
 * fallback, closing the open-redirect hole.
 */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next) return fallback;
  // Must be an absolute path, and the char after the leading slash must not turn
  // it into a network path (`//`, `/\`, `/<whitespace>`).
  if (!next.startsWith("/") || /^\/[/\\\s]/.test(next)) return fallback;
  return next;
}
