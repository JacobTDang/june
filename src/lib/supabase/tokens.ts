/**
 * Cookie holding the signed-in user's Google (YouTube) OAuth access token.
 * Supabase only exposes this token at sign-in, so we capture it into an
 * httpOnly cookie for server routes to use when calling the YouTube API.
 */
export const PROVIDER_TOKEN_COOKIE = "yt_provider_token";
