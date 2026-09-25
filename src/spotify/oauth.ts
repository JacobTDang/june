import { SpotifyAuthError } from "./errors";
import { tokenResponseSchema } from "./schema";

const AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const TOKEN_URL = "https://accounts.spotify.com/api/token";

/** Everything june reads. All read-only. */
export const SPOTIFY_SCOPES: readonly string[] = [
  "user-library-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-top-read",
  "user-read-recently-played",
];

export interface SpotifyOAuthConfig {
  clientId: string;
  clientSecret: string;
}

export interface TokenSet {
  accessToken: string;
  /** Null on a refresh where Spotify kept the existing refresh token. */
  refreshToken: string | null;
  expiresAt: Date;
}

export interface OAuthDeps {
  /** Injectable for tests; defaults to global fetch. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  now?: () => Date;
}

export function authorizeUrl({
  clientId,
  redirectUri,
  state,
}: {
  clientId: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", SPOTIFY_SCOPES.join(" "));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

/**
 * One call to Spotify's token endpoint. Fails loud: missing config, a refused
 * request (with Spotify's own error code, so a revoked grant is recognisable)
 * and an unexpected shape all throw.
 */
async function requestTokens(
  params: URLSearchParams,
  config: SpotifyOAuthConfig,
  deps: OAuthDeps,
): Promise<TokenSet> {
  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      "Spotify is not configured (set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET).",
    );
  }
  const doFetch = deps.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const now = deps.now ?? (() => new Date());

  const response = await doFetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
      error_description?: string;
    } | null;
    const code = body?.error ?? `http_${response.status}`;
    throw new SpotifyAuthError(
      code,
      `Spotify token request failed (${response.status}): ${body?.error_description ?? code}`,
    );
  }

  const tokens = tokenResponseSchema.parse(await response.json());
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? null,
    expiresAt: new Date(now().getTime() + tokens.expires_in * 1000),
  };
}

export function exchangeCode(
  code: string,
  redirectUri: string,
  config: SpotifyOAuthConfig,
  deps: OAuthDeps = {},
): Promise<TokenSet> {
  return requestTokens(
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }),
    config,
    deps,
  );
}

export function refreshTokens(
  refreshToken: string,
  config: SpotifyOAuthConfig,
  deps: OAuthDeps = {},
): Promise<TokenSet> {
  return requestTokens(
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
    config,
    deps,
  );
}

/** The state cookie names whose connect this is as well as the nonce Spotify
 *  must hand back, so a callback started in one june session can't complete
 *  in another's. */
export function stateCookieValue(userId: string, nonce: string): string {
  return `${userId}.${nonce}`;
}

export function stateMatches(
  cookie: string | undefined,
  returned: string | null,
  userId: string,
): boolean {
  if (!cookie || !returned) return false;
  return cookie === stateCookieValue(userId, returned);
}
