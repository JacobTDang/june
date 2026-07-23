/**
 * Pure, browser-free helpers for the admin CLI's browser-login flow, split out
 * here so they're unit-testable without spinning up a loopback server or a real
 * OAuth round-trip. The server/browser glue lives in scripts/admin.ts.
 */

export interface CliSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number; // unix seconds
}

/** Case-insensitive owner check, tolerant of stray whitespace. */
export function isOwner(email: string | null | undefined, adminEmail: string): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === adminEmail.trim().toLowerCase();
}

export type CallbackResult = { code: string } | { error: string };

/** Pull the auth code (or a human-readable error) out of the loopback request URL. */
export function parseAuthCallback(reqUrl: string): CallbackResult {
  let params: URLSearchParams;
  try {
    params = new URL(reqUrl, "http://localhost").searchParams;
  } catch {
    return { error: "Malformed callback request." };
  }
  const error = params.get("error_description") || params.get("error");
  if (error) return { error };
  const code = params.get("code");
  if (code) return { code };
  return { error: "No authorization code in the callback." };
}

/** Treat a token expiring within this window as already stale, to avoid races. */
const EXPIRY_SKEW_SECONDS = 60;

/** Whether a cached access token can be used directly (no refresh needed yet). */
export function sessionUsable(
  session: { access_token?: string; expires_at?: number } | null | undefined,
  nowSeconds: number,
): boolean {
  if (!session?.access_token || typeof session.expires_at !== "number") return false;
  return session.expires_at - EXPIRY_SKEW_SECONDS > nowSeconds;
}

/** Parse a cached session file; null (→ re-auth) on anything malformed or incomplete. */
export function parseSessionCache(text: string): CliSession | null {
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    if (typeof data.access_token === "string" && typeof data.refresh_token === "string") {
      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: typeof data.expires_at === "number" ? data.expires_at : undefined,
      };
    }
  } catch {
    /* fall through to null */
  }
  return null;
}
