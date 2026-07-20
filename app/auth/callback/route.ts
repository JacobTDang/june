import { NextResponse } from "next/server";
import { createClient } from "@/src/lib/supabase/server";
import { PROVIDER_TOKEN_COOKIE } from "@/src/lib/supabase/tokens";

/**
 * OAuth callback: Supabase redirects here with a `code` after Google sign-in.
 * We exchange it for a session and, critically, capture the Google access token
 * (`provider_token`) into an httpOnly cookie — it's only exposed here, once.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

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

  const response = NextResponse.redirect(`${origin}${next}`);

  const providerToken = data.session?.provider_token;
  if (providerToken) {
    response.cookies.set(PROVIDER_TOKEN_COOKIE, providerToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60, // Google access tokens last ~1 hour.
    });
  }

  return response;
}
