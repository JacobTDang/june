import type { SpotifyOAuthConfig } from "../../spotify/oauth";

export const SPOTIFY_STATE_COOKIE = "spotify_oauth_state";

export function spotifyConfig(): SpotifyOAuthConfig {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Spotify is not configured (set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET).",
    );
  }
  return { clientId, clientSecret };
}

/** Must match a redirect URI registered in the Spotify dashboard exactly, which
 *  is why local work on this feature runs at 127.0.0.1 rather than localhost. */
export function spotifyRedirectUri(origin: string): string {
  return `${origin}/api/spotify/callback`;
}
