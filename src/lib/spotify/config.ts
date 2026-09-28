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

/** Where june's server reaches mp3server for library matching. The base URL
 *  is the same one the browser uses; the token is server-only. */
export function mp3serverServiceConfig(): { baseUrl: string; serviceToken: string } {
  const baseUrl = process.env.NEXT_PUBLIC_MP3SERVER_URL;
  const serviceToken = process.env.MP3SERVER_SERVICE_TOKEN;
  if (!baseUrl || !serviceToken) {
    throw new Error(
      "Library matching is not configured (set NEXT_PUBLIC_MP3SERVER_URL and MP3SERVER_SERVICE_TOKEN).",
    );
  }
  return { baseUrl, serviceToken };
}
