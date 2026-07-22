import { NextResponse } from "next/server";
import { createClient } from "@/src/lib/supabase/server";
import { PROVIDER_TOKEN_COOKIE, REFRESH_TOKEN_COOKIE } from "@/src/lib/supabase/tokens";
import { claimSeat, removeUnseatedUser } from "@/src/lib/auth/seats";
import { safeNext } from "@/src/lib/safe-next";

/**
 * OAuth callback: Supabase redirects here with a `code` after Google sign-in.
 * We exchange it for a session and, critically, capture the Google access token
 * (`provider_token`) into an httpOnly cookie — it's only exposed here, once.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=missing_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent(error.message)}`,
    );
  }

  // Enforce the signup cap: admit members and, while there's room, new users.
  // A rejected new account is removed so the seat count stays exact.
  const userId = data.user?.id ?? null;
  if (userId) {
    const admitted = await claimSeat(userId);
    if (!admitted) {
      await removeUnseatedUser(userId);
      return NextResponse.redirect(`${origin}/?full=1`);
    }
  }

  const response = NextResponse.redirect(`${origin}${next}`);

  // Only capture the YouTube tokens during the "Connect YouTube" flow (yt=1).
  // A plain login returns a token without the youtube scope, which we don't want.
  const connectingYouTube = searchParams.get("yt") === "1";
  if (connectingYouTube) {
    const providerToken = data.session?.provider_token;
    const refreshToken = data.session?.provider_refresh_token;

    if (providerToken) {
      response.cookies.set(PROVIDER_TOKEN_COOKIE, providerToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60, // Google access tokens last ~1 hour; cached fast path.
      });
    }

    // The durable credential: mint fresh access tokens from this so the
    // connection persists without re-authorizing (until revoked).
    if (refreshToken) {
      response.cookies.set(REFRESH_TOKEN_COOKIE, refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 400, // ~400 days (browser cap).
      });
    }
  }

  return response;
}
