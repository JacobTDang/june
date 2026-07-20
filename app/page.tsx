import { cookies } from "next/headers";
import { createClient } from "@/src/lib/supabase/server";
import { PROVIDER_TOKEN_COOKIE } from "@/src/lib/supabase/tokens";
import { SignInButton } from "./sign-in-button";
import { ConnectYouTubeButton } from "./connect-youtube-button";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const youtubeConnected = Boolean((await cookies()).get(PROVIDER_TOKEN_COOKIE)?.value);

  return (
    <main className="container">
      {youtubeConnected && (
        <span className="pill">
          <span className="pill__dot" />
          YouTube connected
        </span>
      )}

      <h1 className="display">june</h1>
      <p className="lead">A jam room for YouTube Music — listen together, in sync.</p>

      {!user ? (
        <SignInButton />
      ) : (
        <div className="stack">
          <p className="muted">Signed in as {user.email}</p>

          {youtubeConnected ? (
            <a href="/playlists" className="btn">
              View your playlists →
            </a>
          ) : (
            <>
              <p className="muted">Connect YouTube to import your playlists into a jam.</p>
              <ConnectYouTubeButton />
            </>
          )}

          <form action="/auth/signout" method="post">
            <button type="submit" className="btn">
              Sign out
            </button>
          </form>
        </div>
      )}
    </main>
  );
}
