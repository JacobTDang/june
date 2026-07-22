/**
 * Cookie holding the signed-in user's Google (YouTube) OAuth access token.
 * Supabase only exposes this token at sign-in, so we capture it into an
 * httpOnly cookie for server routes to use when calling the YouTube API.
 */
export const PROVIDER_TOKEN_COOKIE = "yt_provider_token";

/**
 * Cookie holding the Google refresh token (captured once at connect time when
 * we request offline access). It's long-lived, so we can mint fresh access
 * tokens from it and keep YouTube connected without re-authorizing.
 */
export const REFRESH_TOKEN_COOKIE = "yt_refresh_token";
