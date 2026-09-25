import { NextResponse } from "next/server";
import { SPOTIFY_STATE_COOKIE, spotifyConfig, spotifyRedirectUri } from "@/src/lib/spotify/config";
import { createClient } from "@/src/lib/supabase/server";
import { authorizeUrl, stateCookieValue } from "@/src/spotify/oauth";

/** Starts "Connect Spotify": remembers who asked, then hands over to Spotify. */
export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(`${origin}/?next=${encodeURIComponent("/library")}`);

  let clientId: string;
  try {
    ({ clientId } = spotifyConfig());
  } catch (err) {
    return NextResponse.redirect(
      `${origin}/library?spotify_error=${encodeURIComponent((err as Error).message)}`,
    );
  }

  const nonce = crypto.randomUUID();
  const response = NextResponse.redirect(
    authorizeUrl({ clientId, redirectUri: spotifyRedirectUri(origin), state: nonce }),
  );
  response.cookies.set(SPOTIFY_STATE_COOKIE, stateCookieValue(user.id, nonce), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // lax: the callback arrives as a top-level navigation from Spotify.
    sameSite: "lax",
    path: "/api/spotify",
    maxAge: 10 * 60,
  });
  return response;
}
