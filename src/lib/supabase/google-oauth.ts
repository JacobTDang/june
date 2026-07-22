export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface RefreshDeps {
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch;
}

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * Exchange a long-lived Google refresh token for a fresh access token.
 *
 * Fails loud: throws on missing config, a missing refresh token, a non-OK
 * response (e.g. the user revoked access → `invalid_grant`), or a response with
 * no access token — never returns a stale/empty token silently.
 */
export async function refreshAccessToken(
  refreshToken: string,
  config: GoogleOAuthConfig,
  deps: RefreshDeps = {},
): Promise<string> {
  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      "Google OAuth is not configured (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).",
    );
  }
  if (!refreshToken) {
    throw new Error("No YouTube refresh token available — connect YouTube again.");
  }

  const doFetch = deps.fetch ?? fetch;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await doFetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`YouTube token refresh failed (${res.status}). ${detail}`.trim());
  }

  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("YouTube token refresh returned no access token.");
  }
  return data.access_token;
}
