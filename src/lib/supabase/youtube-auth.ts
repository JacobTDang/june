import { cookies } from "next/headers";
import { PROVIDER_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "./tokens";
import { refreshAccessToken } from "./google-oauth";

/**
 * A usable Google access token for the YouTube API, or null if the user hasn't
 * connected YouTube. Uses the cached 1-hour access token when it's still around,
 * otherwise mints a fresh one from the long-lived refresh token so the
 * connection effectively persists without re-authorizing.
 */
export async function getYouTubeAccessToken(): Promise<string | null> {
  const jar = await cookies();

  const cached = jar.get(PROVIDER_TOKEN_COOKIE)?.value;
  if (cached) return cached;

  const refresh = jar.get(REFRESH_TOKEN_COOKIE)?.value;
  if (!refresh) return null;

  return refreshAccessToken(refresh, {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  });
}

/** Whether the user has a durable YouTube connection (a refresh token on hand). */
export async function isYouTubeConnected(): Promise<boolean> {
  const jar = await cookies();
  return Boolean(jar.get(REFRESH_TOKEN_COOKIE)?.value || jar.get(PROVIDER_TOKEN_COOKIE)?.value);
}
