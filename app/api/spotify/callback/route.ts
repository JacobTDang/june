import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { SPOTIFY_STATE_COOKIE, spotifyConfig, spotifyRedirectUri } from "@/src/lib/spotify/config";
import { AlreadyLinkedError, saveConnection } from "@/src/lib/spotify/connection";
import { syncOneUser } from "@/src/lib/spotify/sync";
import { createClient } from "@/src/lib/supabase/server";
import { createSpotifyClient } from "@/src/spotify/client";
import { isNotApprovedForApp } from "@/src/spotify/errors";
import { exchangeCode, stateMatches } from "@/src/spotify/oauth";

/** A first sync of a large library runs in after() and needs the room. */
export const maxDuration = 300;

/**
 * Spotify sends the user back here. Check the state, exchange the code, save
 * the connection, and start the first sync after answering, so the user lands
 * on /library straight away.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const clearState = (response: NextResponse) => {
    response.cookies.set(SPOTIFY_STATE_COOKIE, "", { path: "/api/spotify", maxAge: 0 });
    return response;
  };
  const back = (query: string) => {
    return clearState(NextResponse.redirect(`${origin}/library?${query}`));
  };
  const fail = (code: string) => back(`spotify_error=${encodeURIComponent(code)}`);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return clearState(NextResponse.redirect(`${origin}/?next=${encodeURIComponent("/library")}`));

  const refused = searchParams.get("error");
  if (refused) return fail(refused);

  const cookieStore = await cookies();
  if (!stateMatches(cookieStore.get(SPOTIFY_STATE_COOKIE)?.value, searchParams.get("state"), user.id)) {
    return fail("state");
  }

  const code = searchParams.get("code");
  if (!code) return fail("missing_code");

  try {
    const tokens = await exchangeCode(code, spotifyRedirectUri(origin), spotifyConfig());
    const me = await createSpotifyClient({ accessToken: tokens.accessToken }).me();
    await saveConnection(user.id, me, tokens);
  } catch (err) {
    if (isNotApprovedForApp(err)) return fail("not_approved");
    if (err instanceof AlreadyLinkedError) return fail("already_linked");
    console.error("Spotify connect failed:", err);
    return fail("failed");
  }

  const userId = user.id;
  after(async () => {
    try {
      const result = await syncOneUser(userId);
      if (result.status === "busy") {
        console.warn(`First Spotify sync for ${userId} deferred: another run holds the lease.`);
      }
    } catch (err) {
      console.error(`First Spotify sync for ${userId} failed:`, err);
    }
  });

  return back("spotify=connected");
}
